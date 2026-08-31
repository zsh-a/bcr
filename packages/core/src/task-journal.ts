import { Context, Effect, Layer } from "effect";
import type { ArtifactRef, ComputeTask, TaskJournalEntry } from "./schema";

export interface TaskJournal {
  /** 写前日志：同 taskId 重放时保留 createdAt/attempts，清掉旧终态。 */
  readonly recordSubmitted: (task: ComputeTask) => Effect.Effect<void>;
  /** 真正取得资源、进入 executor 时调用；每次 retry/recovery 都增加 attempts。 */
  readonly recordRunning: (taskId: string) => Effect.Effect<void>;
  readonly recordCompleted: (
    taskId: string,
    outputs: ReadonlyArray<ArtifactRef>,
  ) => Effect.Effect<void>;
  readonly recordFailed: (taskId: string, error: string) => Effect.Effect<void>;
  readonly recordCancelled: (taskId: string) => Effect.Effect<void>;
  readonly recordBlocked: (taskId: string, reason: string) => Effect.Effect<void>;
  /** 按 createdAt 升序返回，恢复时保持原提交顺序。 */
  readonly entries: Effect.Effect<ReadonlyArray<TaskJournalEntry>>;
}

export class TaskJournalTag extends Context.Tag("bcr/TaskJournal")<TaskJournalTag, TaskJournal>() {}

function terminal(
  entries: Map<string, TaskJournalEntry>,
  taskId: string,
  patch:
    | {
        readonly status: "completed";
        readonly outputs: ReadonlyArray<ArtifactRef>;
      }
    | {
        readonly status: "failed" | "cancelled" | "blocked";
        readonly error: string;
      },
): void {
  const current = entries.get(taskId);
  if (current === undefined) return;
  const updatedAt = Date.now();
  const { outputs: _outputs, error: _error, ...base } = current;
  if (patch.status === "completed") {
    entries.set(taskId, {
      ...base,
      status: patch.status,
      updatedAt,
      outputs: patch.outputs,
    });
  } else {
    entries.set(taskId, {
      ...base,
      status: patch.status,
      updatedAt,
      error: patch.error,
    });
  }
}

/** 可共享的内存实现，测试和无 SQLite 宿主均可使用。 */
export function makeMemoryTaskJournal(): TaskJournal {
  const entries = new Map<string, TaskJournalEntry>();
  return {
    recordSubmitted: (task) =>
      Effect.sync(() => {
        const now = Date.now();
        const previous = entries.get(task.id);
        entries.set(task.id, {
          task,
          status: "queued",
          createdAt: previous?.createdAt ?? now,
          updatedAt: now,
          attempts: previous?.attempts ?? 0,
        });
      }),
    recordRunning: (taskId) =>
      Effect.sync(() => {
        const current = entries.get(taskId);
        if (current === undefined) return;
        entries.set(taskId, {
          ...current,
          status: "running",
          updatedAt: Date.now(),
          attempts: current.attempts + 1,
        });
      }),
    recordCompleted: (taskId, outputs) =>
      Effect.sync(() => terminal(entries, taskId, { status: "completed", outputs })),
    recordFailed: (taskId, error) =>
      Effect.sync(() => terminal(entries, taskId, { status: "failed", error })),
    recordCancelled: (taskId) =>
      Effect.sync(() => terminal(entries, taskId, { status: "cancelled", error: "cancelled" })),
    recordBlocked: (taskId, reason) =>
      Effect.sync(() => terminal(entries, taskId, { status: "blocked", error: reason })),
    entries: Effect.sync(() =>
      [...entries.values()].sort(
        (a, b) => a.createdAt - b.createdAt || a.task.id.localeCompare(b.task.id),
      ),
    ),
  };
}

export function memoryTaskJournal(): Layer.Layer<TaskJournalTag> {
  return Layer.sync(TaskJournalTag, makeMemoryTaskJournal);
}
