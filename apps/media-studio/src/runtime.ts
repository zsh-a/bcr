import {
  artifactStore,
  ArtifactStoreTag,
  executorRegistry,
  Executors,
  memoryCacheStore,
  schedulerLive,
  SchedulerTag,
  type ArtifactRef,
  type ComputeTask,
  type RuntimeExecutor,
} from "@bcr/core";
import type { RuntimeServices } from "@bcr/react";
import { workerExecutor, WorkerPool } from "@bcr/runtime-worker";
import { isOpfsSupported, MemoryStore, OpfsStore } from "@bcr/storage-opfs";
import {
  openSqliteDb,
  sqliteCacheStore,
  sqliteLineageStore,
  type SqliteDb,
} from "@bcr/storage-sqlite";
import initSqlite from "@sqlite.org/sqlite-wasm";
import wasmUrl from "@sqlite.org/sqlite-wasm/sqlite3.wasm?url";
import { Chunk, Context, Effect, Layer, Option, Stream } from "effect";
import { TaskFailed } from "@bcr/core";
import type { MediaInfo } from "./subtitles";

/**
 * Subtitle Studio 的 Runtime 组装（§1 分层）：
 * - runtime "js"  → 主线程 decode executor（AudioContext 仅主线程可用）
 * - runtime "wasm" → media.worker（波形 kernel + ASR/segment/translate）
 * 元数据（缓存/血缘/项目状态）落 SQLite → OPFS（§8）。
 */

export const SAMPLE_RATE = 16_000;

let metaDb: SqliteDb | undefined;

export function metaDatabase(): SqliteDb | undefined {
  return metaDb;
}

type SqliteInit = (options?: {
  locateFile?: (file: string) => string;
}) => Promise<Parameters<typeof openSqliteDb>[0]["sqlite3"]>;

async function openMetaDb(store: OpfsStore | MemoryStore): Promise<SqliteDb> {
  const init = initSqlite as unknown as SqliteInit;
  const sqlite3 = await init({ locateFile: () => wasmUrl });
  return openSqliteDb({ store, path: "project/meta.db", sqlite3 });
}

// ── decode executor（runtime "js"，主线程） ─────────────────────────

/** AudioContext 只在主线程存在：decode 作为内联 executor 挂在 "js" 平面。 */
function decodeExecutor(artifacts: RuntimeServices["artifacts"]): RuntimeExecutor {
  const decode = async function* (
    task: ComputeTask,
  ): AsyncGenerator<TaskEventLike, void, undefined> {
    const input = task.inputs[0];
    if (input === undefined) throw new Error("media.decode-audio requires a source file input");
    yield { type: "progress", taskId: task.id, value: 0.05 };

    const bytes = await Effect.runPromise(artifacts.get(input));
    const context = new OfflineAudioContext(1, 1, SAMPLE_RATE);
    // decodeAudioData 会 detach 底层 buffer，bytes 是存储层副本，可安全移交
    const audioBuffer = await context.decodeAudioData(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    );
    yield { type: "progress", taskId: task.id, value: 0.6 };

    const samples = toMono(audioBuffer);
    const pcmBytes = new Uint8Array(samples.buffer.slice(0));
    const pcmRef: ArtifactRef = {
      id: `pcm16k/${input.id}`,
      type: "audio/pcm-f32",
      storage: "opfs",
      format: "f32le",
    };
    await Effect.runPromise(artifacts.put(pcmRef, pcmBytes));

    const info: MediaInfo = {
      durationS: audioBuffer.duration,
      sampleRate: SAMPLE_RATE,
      samples: samples.length,
    };
    const infoRef: ArtifactRef = {
      id: `info/${input.id}`,
      type: "media/info",
      // 缓存元数据（SQLite/OPFS）跨刷新存活，产物引用必须指向持久存储，
      // 否则刷新后 cache hit 时 memory 产物已蒸发 → ArtifactNotFound
      storage: "opfs",
      format: "json",
    };
    await Effect.runPromise(artifacts.put(infoRef, new TextEncoder().encode(JSON.stringify(info))));
    yield { type: "progress", taskId: task.id, value: 1 };
    yield { type: "completed", taskId: task.id, outputs: [pcmRef, infoRef] };
  };

  return {
    runtime: "js",
    version: "media-decode-0.1.1",
    run: (task) =>
      Stream.async<TaskEventLike, TaskFailed>((emit) => {
        void (async () => {
          try {
            for await (const event of decode(task)) {
              emit(Effect.succeed(Chunk.of(event)));
            }
            emit(Effect.fail(Option.none()));
          } catch (error) {
            emit(
              Effect.fail(
                Option.some(
                  new TaskFailed({
                    taskId: task.id,
                    message: error instanceof Error ? error.message : String(error),
                  }),
                ),
              ),
            );
          }
        })();
      }),
  };
}

type TaskEventLike =
  | { type: "progress"; taskId: string; value: number }
  | { type: "chunk"; taskId: string; artifact: ArtifactRef }
  | { type: "completed"; taskId: string; outputs: ReadonlyArray<ArtifactRef> }
  | { type: "failed"; taskId: string; error: string };

function toMono(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
  const out = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < out.length; i += 1) {
      out[i] = (out[i] ?? 0) + (data[i] ?? 0) / buffer.numberOfChannels;
    }
  }
  return out;
}

// ── 组装 ─────────────────────────────────────────────────────────────

export async function createRuntimeServices(): Promise<RuntimeServices> {
  const opfs = isOpfsSupported() ? new OpfsStore("media") : new MemoryStore();
  const memory = new MemoryStore();

  try {
    metaDb = await openMetaDb(opfs);
  } catch (error) {
    metaDb = undefined;
    console.warn("[media-studio] sqlite unavailable, metadata in-memory only:", error);
  }

  const artifactsCtx = await Effect.runPromise(
    Effect.scoped(
      Layer.build(artifactStore({ memory, opfs }, metaDb && sqliteLineageStore(metaDb))),
    ),
  );
  const artifacts = Context.get(artifactsCtx, ArtifactStoreTag);

  const pool = new WorkerPool(
    Math.max(1, (navigator.hardwareConcurrency ?? 2) - 1),
    () =>
      new Worker(new URL("./workers/media.worker.ts", import.meta.url), {
        type: "module",
      }),
  );
  const wasmExecutor = workerExecutor(pool, "wasm", "media-worker-0.1.1", artifacts);
  const jsExecutor = decodeExecutor(artifacts);

  const deps = Layer.mergeAll(
    Layer.succeed(ArtifactStoreTag, artifacts),
    metaDb !== undefined ? sqliteCacheStore(metaDb) : memoryCacheStore(),
    Layer.succeed(Executors, executorRegistry([wasmExecutor, jsExecutor])),
  );
  const live = Layer.provideMerge(schedulerLive, deps);
  const ctx = await Effect.runPromise(Effect.scoped(Layer.build(live)));

  return { scheduler: Context.get(ctx, SchedulerTag), artifacts };
}

export type { ComputeTask };
