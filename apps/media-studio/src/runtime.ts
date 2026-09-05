import type { RuntimeHost, RuntimeSession } from "@bcr/core";
import { type ComputeTask } from "@bcr/core";
import { createBrowserRuntime } from "@bcr/runtime-browser";
import { workerExecutor, WorkerPool } from "@bcr/runtime-worker";
import { type BinaryStore } from "@bcr/storage-opfs";
import { openSqliteDb, type SqliteDb } from "@bcr/storage-sqlite";
import initSqlite from "@sqlite.org/sqlite-wasm";
import wasmUrl from "@sqlite.org/sqlite-wasm/sqlite3.wasm?url";
import { createDecodeExecutor } from "./decode-executor";

/**
 * Subtitle Studio 的 Runtime 组装（§1 分层）：
 * - runtime "js"  → 主线程 decode executor（Mediabunny + WebCodecs 流式解码，§4）
 * - runtime "wasm" → media.worker（波形 kernel + ASR/segment/translate）
 * 元数据（缓存/血缘/项目状态）落 SQLite → OPFS（§8）。
 */

type SqliteInit = (options?: {
  locateFile?: (file: string) => string;
}) => Promise<Parameters<typeof openSqliteDb>[0]["sqlite3"]>;

async function openMetaDb(store: BinaryStore): Promise<SqliteDb> {
  const init = initSqlite as unknown as SqliteInit;
  const sqlite3 = await init({ locateFile: () => wasmUrl });
  return openSqliteDb({ store, path: "project/meta.db", sqlite3 });
}

// ── 组装 ─────────────────────────────────────────────────────────────

export async function createRuntimeServices(host?: RuntimeHost): Promise<RuntimeSession> {
  return createBrowserRuntime({
    namespace: "media",
    host,
    openMetadata: openMetaDb,
    onMetadataUnavailable: (error) => console.warn("[media] metadata unavailable", error),
    execution: (artifacts) => {
      const pool = new WorkerPool(
        {
          minSize: 1,
          maxSize: Math.max(1, (navigator.hardwareConcurrency ?? 2) - 1),
          idleTimeoutMs: 30_000,
        },
        () => new Worker(new URL("./workers/media.worker.ts", import.meta.url), { type: "module" }),
      );
      return {
        executors: [
          workerExecutor(pool, "wasm", "media-operations-1", artifacts, [
            "audio.waveform",
            "asr.transcribe",
            "subtitle.segment",
            "subtitle.translate",
          ]),
          createDecodeExecutor(artifacts),
        ],
        dispose: () => pool.shutdown(),
      };
    },
  });
}

export type { ComputeTask };
