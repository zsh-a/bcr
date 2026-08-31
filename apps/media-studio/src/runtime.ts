import {
  artifactStore,
  artifactPath,
  ArtifactStoreTag,
  contentHash,
  createContentHasher,
  executorRegistry,
  Executors,
  memoryCacheStore,
  schedulerLive,
  SchedulerTag,
  TaskFailed,
  type ArtifactRef,
  type ComputeTask,
  type RuntimeExecutor,
} from "@bcr/core";
import type { RuntimeServices } from "@bcr/react";
import { workerExecutor, WorkerPool } from "@bcr/runtime-worker";
import { isOpfsSupported, MemoryStore, OpfsStore, type BinaryStore } from "@bcr/storage-opfs";
import {
  openSqliteDb,
  sqliteCacheStore,
  sqliteLineageStore,
  type SqliteDb,
} from "@bcr/storage-sqlite";
import initSqlite from "@sqlite.org/sqlite-wasm";
import wasmUrl from "@sqlite.org/sqlite-wasm/sqlite3.wasm?url";
import { Chunk, Context, Effect, Layer, Option, Stream } from "effect";
import { ALL_FORMATS, AudioBufferSink, BlobSource, Input } from "mediabunny";
import type { MediaInfo } from "./subtitles";

/**
 * Subtitle Studio 的 Runtime 组装（§1 分层）：
 * - runtime "js"  → 主线程 decode executor（Mediabunny + WebCodecs 流式解码，§4）
 * - runtime "wasm" → media.worker（波形 kernel + ASR/segment/translate）
 * 元数据（缓存/血缘/项目状态）落 SQLite → OPFS（§8）。
 */

export const SAMPLE_RATE = 16_000;
const DECODE_VERSION = "media-decode-0.3.0";
const textEncoder = new TextEncoder();

function artifactIdentity(ref: ArtifactRef): string {
  return ref.hash ?? contentHash(textEncoder.encode(ref.id));
}

let metaDb: SqliteDb | undefined;
let binaryStore: BinaryStore | undefined;

export function metaDatabase(): SqliteDb | undefined {
  return metaDb;
}

/** 源文件所在的二进制存储：大文件取文件句柄 Blob（不整段进内存）时用。 */
export function sourceBlobStore(): BinaryStore | undefined {
  return binaryStore;
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

/** 整段 decodeAudioData 的安全上限（浏览器 ArrayBuffer 约 2GB）；超出只走流式解码。 */
const LEGACY_DECODE_MAX_BYTES = 1024 * 1024 * 1024;

/** 流式输出窗口：30s × 16kHz × f32 ≈ 1.9MB。 */
const WINDOW_FRAMES = SAMPLE_RATE * 30;

/**
 * 逐块线性重采样 → 16kHz：跨块保持小数相位与末样本，输出定长窗。
 * ASR 对重采样精度不敏感，线性插值足够；避免 OfflineAudioContext 的整段装载。
 */
class Resampler {
  private pending = new Float32Array(WINDOW_FRAMES);
  private pendingLen = 0;
  private nextSrcPos = 0;
  private consumed = 0;
  private carry = 0;
  private hasCarry = false;

  push(mono: Float32Array, srcRate: number): Float32Array[] {
    if (mono.length === 0) return [];
    if (srcRate === SAMPLE_RATE) return this.emit(mono);

    const ratio = srcRate / SAMPLE_RATE;
    const out: number[] = [];
    const base = this.consumed - 1;
    const extAt = (i: number): number =>
      i === 0
        ? this.hasCarry
          ? this.carry
          : (mono[0] ?? 0)
        : (mono[Math.min(i - 1, mono.length - 1)] ?? 0);

    while (this.nextSrcPos < base + mono.length) {
      const local = this.nextSrcPos - base;
      const i = Math.max(0, Math.floor(local));
      const frac = Math.max(0, local - i);
      out.push(extAt(i) * (1 - frac) + extAt(i + 1) * frac);
      this.nextSrcPos += ratio;
    }
    this.consumed += mono.length;
    this.carry = mono[mono.length - 1] ?? 0;
    this.hasCarry = true;
    return this.emit(Float32Array.from(out));
  }

  flush(): Float32Array[] {
    if (this.pendingLen === 0) return [];
    const tail = this.pending.slice(0, this.pendingLen);
    this.pendingLen = 0;
    return [tail];
  }

  private emit(samples: Float32Array): Float32Array[] {
    const out: Float32Array[] = [];
    let offset = 0;
    while (offset < samples.length) {
      const n = Math.min(WINDOW_FRAMES - this.pendingLen, samples.length - offset);
      this.pending.set(samples.subarray(offset, offset + n), this.pendingLen);
      this.pendingLen += n;
      offset += n;
      if (this.pendingLen === WINDOW_FRAMES) {
        out.push(this.pending);
        this.pending = new Float32Array(WINDOW_FRAMES);
        this.pendingLen = 0;
      }
    }
    return out;
  }
}

/** 源文件 Blob：OPFS 走文件句柄快照（磁盘引用，不整段进内存）。 */
async function sourceBlob(
  store: BinaryStore | undefined,
  artifacts: RuntimeServices["artifacts"],
  ref: ArtifactRef,
): Promise<Blob> {
  if (ref.storage === "opfs" && store !== undefined) {
    const blob = await store.getBlob?.(artifactPath(ref));
    if (blob !== undefined) return blob;
  }
  const bytes = await Effect.runPromise(artifacts.get(ref));
  return new Blob([
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as BlobPart,
  ]);
}

function decodeExecutor(
  artifacts: RuntimeServices["artifacts"],
  store: () => BinaryStore | undefined,
): RuntimeExecutor {
  const decode = async function* (
    task: ComputeTask,
  ): AsyncGenerator<TaskEventLike, void, undefined> {
    const input = task.inputs.find((ref) => ref.port === "source") ?? task.inputs[0];
    if (input === undefined) throw new Error("media.decode-audio requires a source file input");
    yield { type: "progress", taskId: task.id, value: 0.02 };

    const blob = await sourceBlob(store(), artifacts, input);
    try {
      yield* decodeStreaming(task, input, blob);
    } catch (error) {
      // 容器解析失败：小文件回退整段 decodeAudioData；大文件报诚实错误
      if (blob.size > LEGACY_DECODE_MAX_BYTES) {
        throw new Error(
          `无法流式解码（${error instanceof Error ? error.message : String(error)}）；` +
            "文件超过 1GB，仅支持流式路径（mp4/webm/mkv/mov/mp3/wav/m4a/ogg）",
        );
      }
      yield* decodeLegacy(task, input, blob);
    }
  };

  /** Mediabunny 解复用 + WebCodecs 解码 → 16k 单声道 PCM 分窗写 OPFS（§4 stream→stream）。 */
  const decodeStreaming = async function* (
    task: ComputeTask,
    input: ArtifactRef,
    blob: Blob,
  ): AsyncGenerator<TaskEventLike, void, undefined> {
    const media = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
    const track = await media.getPrimaryAudioTrack();
    if (track === null) throw new Error("文件不包含音轨");
    if (!(await track.canDecode())) {
      throw new Error(`当前浏览器无法解码该音轨（codec: ${track.codec}）`);
    }
    const durationS = await media.computeDuration();

    const pcmRef: ArtifactRef = {
      id: `pcm16k/${DECODE_VERSION}/${artifactIdentity(input)}`,
      type: "audio/pcm-f32",
      storage: "opfs",
      format: "f32le",
    };
    const pcmHasher = createContentHasher();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    });
    const writeDone = Effect.runPromise(artifacts.putStream(pcmRef, stream));

    const resampler = new Resampler();
    let totalSamples = 0;
    let lastReport = 0.05;
    try {
      const sink = new AudioBufferSink(track);
      for await (const wrapped of sink.buffers()) {
        const mono = toMono(wrapped.buffer);
        for (const chunk of resampler.push(mono, wrapped.buffer.sampleRate)) {
          totalSamples += chunk.length;
          const bytes = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
          pcmHasher.update(bytes);
          controller.enqueue(bytes);
        }
        const progress = 0.05 + 0.9 * Math.min(1, wrapped.timestamp / Math.max(1, durationS));
        if (progress - lastReport >= 0.02) {
          lastReport = progress;
          yield { type: "progress", taskId: task.id, value: progress };
        }
      }
      for (const chunk of resampler.flush()) {
        totalSamples += chunk.length;
        const bytes = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
        pcmHasher.update(bytes);
        controller.enqueue(bytes);
      }
      controller.close();
    } catch (error) {
      controller.error(error);
      throw error;
    }
    await writeDone;
    yield* finish(task, { ...pcmRef, hash: pcmHasher.digest() }, totalSamples, durationS);
  };

  /** 旧路径：整段 decodeAudioData（仅小文件回退）。 */
  const decodeLegacy = async function* (
    task: ComputeTask,
    input: ArtifactRef,
    blob: Blob,
  ): AsyncGenerator<TaskEventLike, void, undefined> {
    const context = new OfflineAudioContext(1, 1, SAMPLE_RATE);
    const audioBuffer = await context.decodeAudioData(await blob.arrayBuffer());
    yield { type: "progress", taskId: task.id, value: 0.6 };

    const samples = toMono(audioBuffer);
    const pcmBytes = new Uint8Array(samples.buffer.slice(0));
    const pcmRef: ArtifactRef = {
      id: `pcm16k/${DECODE_VERSION}/${artifactIdentity(input)}`,
      type: "audio/pcm-f32",
      storage: "opfs",
      format: "f32le",
      hash: contentHash(pcmBytes),
    };
    await Effect.runPromise(artifacts.put(pcmRef, pcmBytes));
    yield* finish(task, pcmRef, samples.length, audioBuffer.duration);
  };

  /** 收尾：写 media/info 产物 + completed 事件。 */
  const finish = async function* (
    task: ComputeTask,
    pcmRef: ArtifactRef,
    samples: number,
    durationS: number,
  ): AsyncGenerator<TaskEventLike, void, undefined> {
    const info: MediaInfo = { durationS, sampleRate: SAMPLE_RATE, samples };
    const infoBytes = textEncoder.encode(JSON.stringify(info));
    const infoHash = contentHash(infoBytes);
    const infoRef: ArtifactRef = {
      id: `info/${infoHash}`,
      type: "media/info",
      // 缓存元数据（SQLite/OPFS）跨刷新存活，产物引用必须指向持久存储，
      // 否则刷新后 cache hit 时 memory 产物已蒸发 → ArtifactNotFound
      storage: "opfs",
      format: "json",
      hash: infoHash,
    };
    await Effect.runPromise(artifacts.put(infoRef, infoBytes));
    yield { type: "progress", taskId: task.id, value: 1 };
    yield { type: "completed", taskId: task.id, outputs: [pcmRef, infoRef] };
  };

  return {
    runtime: "js",
    version: DECODE_VERSION,
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
  binaryStore = opfs;
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
  const wasmExecutor = workerExecutor(pool, "wasm", "media-worker-0.2.0", artifacts);
  const jsExecutor = decodeExecutor(artifacts, () => binaryStore);

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
