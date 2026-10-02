import type { RuntimeHost, RuntimeSession } from "@bcr/core";
import { createBrowserRuntime } from "@bcr/runtime-browser";
import { workerExecutor, WorkerPool } from "@bcr/runtime-worker";
import type { BinaryStore } from "@bcr/storage-opfs";
import { openSqliteDb, type SqliteDb } from "@bcr/storage-sqlite";
import initSqlite from "@sqlite.org/sqlite-wasm";
import wasmUrl from "@sqlite.org/sqlite-wasm/sqlite3.wasm?url";
import { closeResearchService } from "./jsg/research-service";
import { RESEARCH_NAMESPACE } from "@bcr/market-data/research/storage";
import { SINGLE_EXECUTOR_VERSION, GRID_EXECUTOR_VERSION } from "./jsg/versions";

type SqliteInit = (options?: {
  locateFile?: (file: string) => string;
}) => Promise<Parameters<typeof openSqliteDb>[0]["sqlite3"]>;

async function openMetaDb(store: BinaryStore): Promise<SqliteDb> {
  const init = initSqlite as unknown as SqliteInit;
  const sqlite3 = await init({ locateFile: () => wasmUrl });
  return openSqliteDb({ store, path: "project/meta.db", sqlite3 });
}

export async function createRuntimeServices(host?: RuntimeHost): Promise<RuntimeSession> {
  let ownedArtifacts: RuntimeSession["artifacts"] | undefined;
  return createBrowserRuntime({
    namespace: RESEARCH_NAMESPACE,
    host,
    openMetadata: openMetaDb,
    beforeDispose: () => closeResearchService(ownedArtifacts),
    onMetadataUnavailable: (error) => console.warn("[quant] metadata unavailable", error),
    execution: (artifacts) => {
      ownedArtifacts = artifacts;
      const pool = new WorkerPool(
        {
          minSize: 1,
          maxSize: Math.max(1, (navigator.hardwareConcurrency ?? 2) - 1),
          idleTimeoutMs: 30_000,
        },
        () => new Worker(new URL("./workers/quant.worker.ts", import.meta.url), { type: "module" }),
      );
      return {
        executors: [
          workerExecutor(pool, "wasm", SINGLE_EXECUTOR_VERSION, artifacts, ["quant.backtest.jsg"]),
          workerExecutor(pool, "wasm", GRID_EXECUTOR_VERSION, artifacts, ["quant.grid.jsg"]),
        ],
        dispose: () => pool.shutdown(),
      };
    },
  });
}
