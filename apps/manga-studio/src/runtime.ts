import { type BinaryStore } from "@bcr/storage-opfs";
import { openSqliteDb, type SqliteDb } from "@bcr/storage-sqlite";
import initSqlite from "@sqlite.org/sqlite-wasm";
import wasmUrl from "@sqlite.org/sqlite-wasm/sqlite3.wasm?url";
import { Effect } from "effect";
import type { RuntimeHost, RuntimeSession } from "@bcr/core";
import { createBrowserRuntime } from "@bcr/runtime-browser";
import { WorkerPool, workerExecutor } from "@bcr/runtime-worker";
import { MANGA_COMPUTE } from "./execution/operations";
import { createMangaPipeline } from "./execution/pipeline";
import { MangaModelRegistry } from "./models/model-registry";
import { manga } from "./project/store";
import { type MangaStorageContext } from "./project/context";
import { persistProject, restoreProject } from "./project/persistence";

export interface MangaRuntime extends MangaStorageContext {
  readonly session?: RuntimeSession;
  readonly pipeline: ReturnType<typeof createMangaPipeline>;
}

interface SqliteInit {
  (options?: {
    locateFile?: (file: string) => string;
  }): Promise<Parameters<typeof openSqliteDb>[0]["sqlite3"]>;
}

let currentRuntime: MangaRuntime | undefined;

async function openMetaDb(store: BinaryStore): Promise<SqliteDb> {
  const init = initSqlite as unknown as SqliteInit;
  const sqlite3 = await init({ locateFile: () => wasmUrl });
  return openSqliteDb({ store, path: "project/meta.db", sqlite3 });
}

/** Storage and standalone compute participate in the host's budget and writer lifetime. */
export async function createMangaRuntime(host?: RuntimeHost): Promise<MangaRuntime> {
  let meta: SqliteDb | undefined;
  let runtime: MangaRuntime | undefined;
  let initialized = false;
  const session = await createBrowserRuntime({
    namespace: "manga",
    host,
    openMetadata: async (store) => (meta = await openMetaDb(store)),
    onMetadataUnavailable: (error) => manga.log("warn", `metadata unavailable · ${String(error)}`),
    beforeDispose: async () => {
      if (runtime) {
        runtime.pipeline.cancelMangaQueue();
        await Effect.runPromise(runtime.session!.scheduler.shutdown);
        try {
          if (initialized) await persistProject(runtime);
        } finally {
          try {
            await runtime.models.close();
          } finally {
            if (currentRuntime === runtime) currentRuntime = undefined;
          }
        }
      }
    },
    execution: (artifacts) => {
      const pool = new WorkerPool(
        { minSize: 0, maxSize: 1, idleTimeoutMs: 30_000 },
        () => new Worker(new URL("./workers/manga.worker.ts", import.meta.url), { type: "module" }),
      );
      return {
        executors: (["wasm", "js"] as const).map((backend) =>
          workerExecutor(pool, backend, "manga-operations-1", artifacts, MANGA_COMPUTE[backend]),
        ),
        dispose: () => pool.shutdown(),
      };
    },
  });
  try {
    const models = new MangaModelRegistry(meta);
    runtime = {
      artifacts: session.artifacts,
      binary: session.binary!,
      meta,
      models,
      session,
      pipeline: createMangaPipeline({ artifacts: session.artifacts, models, store: manga }),
    };
    await models.restore();
    await models.reconcileCache();
    await restoreProject(runtime);
    initialized = true;
    currentRuntime = runtime;
    return runtime;
  } catch (error) {
    await session.dispose();
    throw error;
  }
}

export function mangaRuntime(): MangaRuntime | undefined {
  return currentRuntime;
}
