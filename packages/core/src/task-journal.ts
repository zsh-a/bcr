import { Context, Effect, Layer } from "effect";
import type { ArtifactRef, ComputeTask, TaskJournalEntry } from "./schema";
import {
  selectRetentionCandidates,
  type RetentionOptions,
  type RetentionReason,
} from "./retention";

export interface TaskJournalPruneOptions extends RetentionOptions {
  /** 仅保护指定任务；queued/running 始终隐式保护。 */
  readonly protectedTaskIds?: ReadonlyArray<string> | undefined;
  /** 缺省时治理全部终态；永远不会选择 queued/running。 */
  readonly statuses?: ReadonlyArray<Exclude<TaskJournalEntry["status"], "queued" | "running">>;
}

export interface TaskJournalPruneCandidate {
  readonly entry: TaskJournalEntry;
  readonly reason: RetentionReason;
}

export interface TaskJournalPrunePlan {
  readonly plannedAt: number;
  readonly now: number;
  readonly scannedEntries: number;
  readonly activeEntries: number;
  readonly candidates: ReadonlyArray<TaskJournalPruneCandidate>;
  readonly protectedTaskIds: ReadonlyArray<string>;
  readonly maxAgeMs?: number | undefined;
  readonly maxEntries?: number | undefined;
  readonly statuses: ReadonlyArray<Exclude<TaskJournalEntry["status"], "queued" | "running">>;
}

export type TaskJournalPruneSkipReason =
  | "missing"
  | "changed"
  | "protected"
  | "active"
  | "remove-failed";

export interface TaskJournalPruneSkipped {
  readonly candidate: TaskJournalPruneCandidate;
  readonly reason: TaskJournalPruneSkipReason;
  readonly error?: string | undefined;
}

export interface TaskJournalPruneResult {
  readonly requested: number;
  readonly removed: ReadonlyArray<TaskJournalPruneCandidate>;
  readonly skipped: ReadonlyArray<TaskJournalPruneSkipped>;
}

type TerminalStatus = Exclude<TaskJournalEntry["status"], "queued" | "running">;
const terminalStatuses: ReadonlyArray<TerminalStatus> = [
  "completed",
  "failed",
  "cancelled",
  "blocked",
];

export function planTaskJournalPrune(
  entries: ReadonlyArray<TaskJournalEntry>,
  options: TaskJournalPruneOptions = {},
): TaskJournalPrunePlan {
  const protectedTaskIds = [...new Set(options.protectedTaskIds ?? [])];
  const protectedSet = new Set(protectedTaskIds);
  const statuses =
    options.statuses === undefined ? terminalStatuses : [...new Set(options.statuses)];
  const allowed = new Set(statuses);
  const eligible = entries.filter((entry) => allowed.has(entry.status as TerminalStatus));
  const selection = selectRetentionCandidates(eligible, {
    ...options,
    keyOf: (entry) => entry.task.id,
    createdAtOf: (entry) => entry.createdAt,
    isProtected: (entry) => protectedSet.has(entry.task.id),
  });
  return {
    plannedAt: Date.now(),
    now: selection.now,
    scannedEntries: entries.length,
    activeEntries: entries.filter(
      (entry) => entry.status === "queued" || entry.status === "running",
    ).length,
    candidates: selection.candidates.map(({ item, reason }) => ({ entry: item, reason })),
    protectedTaskIds,
    ...(options.maxAgeMs === undefined ? {} : { maxAgeMs: options.maxAgeMs }),
    ...(options.maxEntries === undefined ? {} : { maxEntries: options.maxEntries }),
    statuses,
  };
}

/** 二次校验任务状态/时间戳后删除历史；运行中任务永远跳过。 */
export function reclaimTaskJournalPrune(
  plan: TaskJournalPrunePlan,
  current: ReadonlyArray<TaskJournalEntry>,
  remove: (taskId: string) => Effect.Effect<void>,
  options?: Pick<TaskJournalPruneOptions, "protectedTaskIds">,
): Effect.Effect<TaskJournalPruneResult> {
  const protectedTaskIds = new Set(options?.protectedTaskIds ?? plan.protectedTaskIds);
  const byId = new Map(current.map((entry) => [entry.task.id, entry]));
  return Effect.gen(function* () {
    const removed: TaskJournalPruneCandidate[] = [];
    const skipped: TaskJournalPruneSkipped[] = [];
    for (const candidate of plan.candidates) {
      const taskId = candidate.entry.task.id;
      if (protectedTaskIds.has(taskId)) {
        skipped.push({ candidate, reason: "protected" });
        continue;
      }
      const fresh = byId.get(taskId);
      if (fresh === undefined) {
        skipped.push({ candidate, reason: "missing" });
        continue;
      }
      if (fresh.status === "queued" || fresh.status === "running") {
        skipped.push({ candidate, reason: "active" });
        continue;
      }
      if (
        fresh.createdAt !== candidate.entry.createdAt ||
        fresh.updatedAt !== candidate.entry.updatedAt ||
        fresh.status !== candidate.entry.status
      ) {
        skipped.push({ candidate, reason: "changed" });
        continue;
      }
      const result = yield* Effect.either(remove(taskId));
      if (result._tag === "Right") {
        removed.push(candidate);
      } else {
        const reason: unknown = result.left;
        skipped.push({
          candidate,
          reason: "remove-failed",
          error: reason instanceof Error ? reason.message : String(reason),
        });
      }
    }
    return { requested: plan.candidates.length, removed, skipped };
  });
}

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
  readonly planPrune: (options?: TaskJournalPruneOptions) => Effect.Effect<TaskJournalPrunePlan>;
  readonly reclaim: (
    plan: TaskJournalPrunePlan,
    options?: Pick<TaskJournalPruneOptions, "protectedTaskIds">,
  ) => Effect.Effect<TaskJournalPruneResult>;
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
  const snapshot = (): ReadonlyArray<TaskJournalEntry> =>
    [...entries.values()].sort(
      (a, b) => a.createdAt - b.createdAt || a.task.id.localeCompare(b.task.id),
    );
  const remove = (taskId: string): Effect.Effect<void> =>
    Effect.sync(() => void entries.delete(taskId));
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
    entries: Effect.sync(snapshot),
    planPrune: (options) =>
      Effect.map(Effect.sync(snapshot), (items) => planTaskJournalPrune(items, options)),
    reclaim: (plan, options) =>
      Effect.flatMap(Effect.sync(snapshot), (items) =>
        reclaimTaskJournalPrune(plan, items, remove, options),
      ),
  };
}

export function memoryTaskJournal(): Layer.Layer<TaskJournalTag> {
  return Layer.sync(TaskJournalTag, makeMemoryTaskJournal);
}
