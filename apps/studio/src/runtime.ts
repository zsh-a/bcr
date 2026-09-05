import type { RuntimeSession } from "@bcr/core";
import {
  createSearchIndex,
  hashReadableStream,
  type ArtifactRef,
  type ComputeTask,
  type Scheduler,
  type TaskHandle,
  type TaskJournalEntry,
} from "@bcr/core";
import type { RuntimeMetadata, RuntimeServices } from "@bcr/react";
import { createBrowserRuntime } from "@bcr/runtime-browser";
import { workerExecutor, WorkerPool } from "@bcr/runtime-worker";
import type { BinaryStore } from "@bcr/storage-opfs";
import { openSqliteDb, type SqliteDb } from "@bcr/storage-sqlite";
import initSqlite from "@sqlite.org/sqlite-wasm";
import wasmUrl from "@sqlite.org/sqlite-wasm/sqlite3.wasm?url";
import { Effect } from "effect";
import { COMPUTE_OPERATIONS } from "./compute-contract";
import { studio, type FileRecord, type TaskRecord } from "./store";

let taskSeq = 0;

/** 元数据库（§8）：SQLite WASM，字节落 OPFS；加载失败降级为纯内存。 */

/** initSqlite 的官方类型未暴露 emscripten locateFile，这里按实际行为约束。 */
type SqliteInit = (options?: {
  locateFile?: (file: string) => string;
}) => Promise<Parameters<typeof openSqliteDb>[0]["sqlite3"]>;

async function openMetaDb(store: BinaryStore): Promise<SqliteDb> {
  const init = initSqlite as unknown as SqliteInit;
  const sqlite3 = await init({ locateFile: () => wasmUrl });
  return openSqliteDb({ store, path: "project/meta.db", sqlite3 });
}

/** 组装 Compute Runtime 并接入 Studio 状态投影。 */
export async function createRuntimeServices(): Promise<RuntimeSession> {
  const session = await createBrowserRuntime({
    namespace: "studio",
    openMetadata: openMetaDb,
    onMetadataUnavailable: (error) => studio.log("warn", "metadata unavailable · " + String(error)),
    execution: (artifacts) => {
      const pool = new WorkerPool(
        {
          minSize: 1,
          maxSize: Math.max(1, (navigator.hardwareConcurrency ?? 2) - 1),
          idleTimeoutMs: 30_000,
        },
        () =>
          new Worker(new URL("./workers/compute.worker.ts", import.meta.url), { type: "module" }),
      );
      return {
        executors: (["wasm", "js"] as const).map((backend) =>
          workerExecutor(
            pool,
            backend,
            "studio-operations-2",
            artifacts,
            COMPUTE_OPERATIONS[backend],
          ),
        ),
        dispose: () => pool.shutdown(),
      };
    },
  });
  const metadata = session.metadata;
  const search = createSearchIndex(
    metadata === undefined
      ? undefined
      : {
          load: () => metadata.get("workspace/search.v1"),
          save: (value) => metadata.set("workspace/search.v1", value),
        },
  );
  try {
    await restoreFiles(metadata);
    await restoreTasks(session.scheduler);
    await search.ready;
    return {
      ...session,
      search,
      dispose: async () => {
        try {
          await search.close();
        } finally {
          await session.host.dispose();
        }
      },
    };
  } catch (error) {
    await session.host.dispose();
    throw error;
  }
}

/** 刷新恢复：文件列表从元数据库回放（artifact 数据本体一直在 OPFS）。 */
async function restoreFiles(metadata: RuntimeMetadata | undefined): Promise<void> {
  if (metadata === undefined) return;
  try {
    const raw = await metadata.get("files");
    if (raw === undefined) return;
    for (const file of JSON.parse(raw) as FileRecord[]) {
      studio.addFile(file);
    }
    studio.log("info", `restore · ${JSON.parse(raw).length} file(s) from metadata`);
  } catch (error) {
    studio.log("warn", `restore files failed · ${String(error)}`);
  }
}

const isActive = (record: TaskRecord): boolean =>
  record.status === "queued" || record.status === "running";

function recordFromJournal(entry: TaskJournalEntry): TaskRecord {
  const terminal =
    entry.status === "completed" ||
    entry.status === "failed" ||
    entry.status === "cancelled" ||
    entry.status === "blocked";
  return {
    id: entry.task.id,
    operation: entry.task.operation,
    runtime: entry.task.runtime,
    inputId: entry.task.inputs[0]?.id ?? "—",
    status: entry.status,
    progress: entry.status === "completed" ? 1 : 0,
    cached: false,
    startedAt: entry.createdAt,
    ...(entry.outputs !== undefined ? { outputs: entry.outputs } : {}),
    ...(entry.error !== undefined ? { error: entry.error } : {}),
    ...(terminal ? { durationMs: Math.max(0, entry.updatedAt - entry.createdAt) } : {}),
  };
}

/** Project the scheduler's authoritative snapshot; events are only for chunks. */
function observeTaskHandle(
  handle: TaskHandle,
  record: TaskRecord,
  recovered = false,
): Promise<void> {
  studio.upsertTask({ ...record, cached: handle.cached });
  let logged = false;
  const sync = () => {
    const snapshot = handle.state.getSnapshot();
    const terminal =
      snapshot.status === "completed" ||
      snapshot.status === "failed" ||
      snapshot.status === "cancelled";
    studio.patchTask(record.id, {
      status: snapshot.status,
      progress: snapshot.progress,
      cached: handle.cached,
      ...(snapshot.status === "completed" ? { outputs: snapshot.outputs } : {}),
      ...("error" in snapshot ? { error: snapshot.error } : {}),
      ...(terminal ? { durationMs: Date.now() - record.startedAt } : {}),
    });
    if (terminal && !logged) {
      logged = true;
      studio.log(
        snapshot.status === "completed" ? "ok" : "error",
        record.operation +
          " · " +
          (handle.cached
            ? "cache hit"
            : recovered
              ? "recovered · " + snapshot.status
              : snapshot.status) +
          " · " +
          record.id,
      );
    }
  };
  const unsubscribe = handle.state.subscribe(sync);
  sync();
  return Effect.runPromise(handle.await)
    .then(
      () => undefined,
      () => undefined,
    )
    .finally(unsubscribe);
}

/** 启动恢复：先投影完整历史，再重放有完整输入的 queued/running 任务。 */
async function restoreTasks(scheduler: Scheduler): Promise<void> {
  try {
    const entries = await Effect.runPromise(scheduler.journalSnapshot);
    for (const entry of entries) studio.upsertTask(recordFromJournal(entry));
    if (entries.length > 0) {
      studio.log("info", `restore · ${entries.length} task(s) from journal`);
    }

    const report = await Effect.runPromise(scheduler.recoverPending());
    for (const { entry, handle } of report.resumed) {
      void observeTaskHandle(handle, recordFromJournal(entry), true);
    }

    if (report.skipped.length > 0) {
      const refreshed = await Effect.runPromise(scheduler.journalSnapshot);
      for (const skipped of report.skipped) {
        const entry = refreshed.find(({ task }) => task.id === skipped.taskId);
        if (entry !== undefined) studio.upsertTask(recordFromJournal(entry));
        studio.log("warn", `recover · ${skipped.taskId} · ${skipped.reason}`);
      }
    }
    if (report.resumed.length > 0) {
      studio.log("info", `recover · resumed ${report.resumed.length} task(s)`);
    }
  } catch (error) {
    studio.log("warn", `restore tasks failed · ${String(error)}`);
  }
}

/** 提交任务并把事件流投影到 Studio store。 */
export async function runTask(
  services: RuntimeServices,
  input: ArtifactRef,
  operation: "hash.blake3" | "audio.waveform",
  sizeBytes?: number,
): Promise<void> {
  taskSeq += 1;
  const task: ComputeTask = {
    id: `task-${Date.now().toString(36)}-${taskSeq.toString(36)}`,
    runtime: "wasm",
    operation,
    inputs: [input],
    outputs: [{ type: "studio/result" }],
    cache: { enabled: true },
    ...(sizeBytes !== undefined ? { config: { sizeBytes } } : {}),
  };

  const handle = await Effect.runPromise(services.scheduler.submit(task));

  const record: TaskRecord = {
    id: task.id,
    operation,
    runtime: task.runtime,
    inputId: input.id,
    status: "running",
    progress: 0,
    cached: false,
    startedAt: Date.now(),
  };
  studio.log("info", `${operation} · submitted · ${input.id}`);
  const settled = observeTaskHandle(handle, record);
  if (handle.cached) await settled;
}

/** 导入文件：流式写入 OPFS（FileArtifact），不整段进内存（§4/§8）。 */
export async function importFile(services: RuntimeServices, file: File): Promise<ArtifactRef> {
  const hash = await hashReadableStream(file.stream());
  const ref: ArtifactRef = {
    id: `source/${hash}`,
    type: `file/${file.name.split(".").pop() ?? "bin"}`,
    storage: "opfs",
    hash,
  };
  await Effect.runPromise(services.artifacts.putStream(ref, file.stream()));
  studio.addFile({
    ref,
    name: file.name,
    size: file.size,
    addedAt: Date.now(),
  });
  persistFiles(services.metadata);
  studio.log("info", `import · ${file.name} · ${file.size} bytes → opfs`);
  return ref;
}

function persistFiles(metadata: RuntimeMetadata | undefined): void {
  if (metadata === undefined) return;
  const files = studio.getSnapshot().files;
  void metadata.set("files", JSON.stringify(files)).catch((error) => {
    studio.log("warn", `persist files failed · ${String(error)}`);
  });
}

export async function cancelTask(services: RuntimeServices, taskId: string): Promise<void> {
  await Effect.runPromise(services.scheduler.cancel(taskId));
  const current = studio.getSnapshot().tasks.find(({ id }) => id === taskId);
  if (current !== undefined && isActive(current)) {
    studio.patchTask(taskId, {
      status: "cancelled",
      error: "cancelled",
      durationMs: Date.now() - current.startedAt,
    });
  }
  studio.log("warn", `cancel · ${taskId}`);
}
