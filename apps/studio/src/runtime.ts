import {
  ArtifactStoreTag,
  artifactStore,
  executorRegistry,
  Executors,
  hashReadableStream,
  memoryCacheStore,
  schedulerLive,
  schedulerLiveWithJournal,
  SchedulerTag,
  type ArtifactRef,
  type ComputeTask,
  type Scheduler,
  type TaskHandle,
  type TaskJournalEntry,
} from "@bcr/core";
import type { RuntimeServices } from "@bcr/react";
import { workerExecutor, WorkerPool } from "@bcr/runtime-worker";
import { isOpfsSupported, MemoryStore, OpfsStore } from "@bcr/storage-opfs";
import {
  openSqliteDb,
  sqliteCacheStore,
  sqliteLineageStore,
  sqliteTaskJournal,
  type SqliteDb,
} from "@bcr/storage-sqlite";
import initSqlite from "@sqlite.org/sqlite-wasm";
import wasmUrl from "@sqlite.org/sqlite-wasm/sqlite3.wasm?url";
import { Context, Effect, Layer, Stream } from "effect";
import { studio, type FileRecord, type TaskRecord } from "./store";

let taskSeq = 0;

/** 元数据库（§8）：SQLite WASM，字节落 OPFS；加载失败降级为纯内存。 */
let metaDb: SqliteDb | undefined;

/** initSqlite 的官方类型未暴露 emscripten locateFile，这里按实际行为约束。 */
type SqliteInit = (options?: {
  locateFile?: (file: string) => string;
}) => Promise<Parameters<typeof openSqliteDb>[0]["sqlite3"]>;

async function openMetaDb(store: OpfsStore | MemoryStore): Promise<SqliteDb> {
  const init = initSqlite as unknown as SqliteInit;
  const sqlite3 = await init({ locateFile: () => wasmUrl });
  return openSqliteDb({ store, path: "project/meta.db", sqlite3 });
}

/** 组装 Compute Runtime 并接入 Studio 状态投影。 */
export async function createRuntimeServices(): Promise<RuntimeServices> {
  const opfs = isOpfsSupported() ? new OpfsStore("studio") : new MemoryStore();
  const memory = new MemoryStore();

  try {
    metaDb = await openMetaDb(opfs);
    studio.log("ok", "sqlite · metadata persistence on · project/meta.db");
  } catch (error) {
    metaDb = undefined;
    studio.log(
      "warn",
      `sqlite unavailable · falling back to in-memory metadata · ${String(error)}`,
    );
  }

  const artifactsCtx = await Effect.runPromise(
    Effect.scoped(
      Layer.build(artifactStore({ memory, opfs }, metaDb && sqliteLineageStore(metaDb))),
    ),
  );
  const artifacts = Context.get(artifactsCtx, ArtifactStoreTag);

  const pool = new WorkerPool(
    {
      minSize: 1,
      maxSize: Math.max(1, (navigator.hardwareConcurrency ?? 2) - 1),
      idleTimeoutMs: 30_000,
    },
    () =>
      new Worker(new URL("./workers/compute.worker.ts", import.meta.url), {
        type: "module",
      }),
  );
  const wasmExecutor = workerExecutor(pool, "wasm", "bcr-kernels-0.2.1", artifacts);

  const deps = Layer.mergeAll(
    Layer.succeed(ArtifactStoreTag, artifacts),
    metaDb !== undefined ? sqliteCacheStore(metaDb) : memoryCacheStore(),
    Layer.succeed(Executors, executorRegistry([wasmExecutor])),
  );
  const schedulerLayer =
    metaDb !== undefined ? schedulerLiveWithJournal(sqliteTaskJournal(metaDb)) : schedulerLive;
  const live = Layer.provideMerge(schedulerLayer, deps);
  const ctx = await Effect.runPromise(Effect.scoped(Layer.build(live)));
  const scheduler = Context.get(ctx, SchedulerTag);

  await restoreFiles();
  await restoreTasks(scheduler);
  return { scheduler, artifacts };
}

/** 刷新恢复：文件列表从元数据库回放（artifact 数据本体一直在 OPFS）。 */
async function restoreFiles(): Promise<void> {
  if (metaDb === undefined) return;
  try {
    const raw = await metaDb.kvGet("files");
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 事件只负责增量进度；handle.await 同时作为不会丢失的终态兜底。 */
function observeTaskHandle(
  handle: TaskHandle,
  record: TaskRecord,
  recovered = false,
): Promise<void> {
  studio.upsertTask({
    ...record,
    status: handle.cached ? "queued" : "running",
    cached: handle.cached,
  });

  const complete = (outputs: ReadonlyArray<ArtifactRef>): void => {
    const current = studio.getSnapshot().tasks.find(({ id }) => id === record.id);
    if (current === undefined || !isActive(current)) return;
    studio.patchTask(record.id, {
      status: "completed",
      progress: 1,
      outputs,
      cached: handle.cached,
      durationMs: Date.now() - record.startedAt,
    });
    studio.log(
      "ok",
      `${record.operation} · ${handle.cached ? "cache hit" : recovered ? "recovered · completed" : "completed"} · ${record.id}`,
    );
  };

  const fail = (message: string): void => {
    const current = studio.getSnapshot().tasks.find(({ id }) => id === record.id);
    if (current === undefined || !isActive(current)) return;
    studio.patchTask(record.id, {
      status: message === "cancelled" ? "cancelled" : "failed",
      error: message,
      durationMs: Date.now() - record.startedAt,
    });
    studio.log("error", `${record.operation} · ${message} · ${record.id}`);
  };

  Effect.runFork(
    Stream.runForEach(handle.events, (event) =>
      Effect.sync(() => {
        switch (event.type) {
          case "progress":
            studio.patchTask(record.id, { status: "running", progress: event.value });
            break;
          case "completed":
            complete(event.outputs);
            break;
          case "failed":
            fail(event.error);
            break;
          case "chunk":
            break;
        }
      }),
    ),
  );

  return Effect.runPromise(handle.await)
    .then(complete)
    .catch((error: unknown) => {
      fail(errorMessage(error));
    });
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
  persistFiles();
  studio.log("info", `import · ${file.name} · ${file.size} bytes → opfs`);
  return ref;
}

function persistFiles(): void {
  if (metaDb === undefined) return;
  const files = studio.getSnapshot().files;
  void metaDb.kvSet("files", JSON.stringify(files)).catch((error) => {
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
