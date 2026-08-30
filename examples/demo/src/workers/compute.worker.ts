import { artifactPath, type ArtifactRef } from "@bcr/core";
import { defineWorker, type WorkerContext } from "@bcr/runtime-worker";
import { OpfsStore } from "@bcr/storage-opfs";
import init, {
  peak_f32,
  rms_f32,
  StreamingBlake3,
} from "../../../../crates/kernels/pkg/bcr_kernels.js";

/**
 * compute.worker（架构文档 §5）：Worker 内加载 Rust WASM kernel。
 * 大文件按 4MB 窗口从 OPFS 流动读取（§4），禁止整段装载。
 */

const WINDOW = 4 * 1024 * 1024;
const opfs = new OpfsStore("demo");

const wasmReady = init();

function throwIfAborted(ctx: WorkerContext): void {
  if (ctx.signal.aborted) {
    throw new Error("cancelled");
  }
}

async function hashBlake3(
  input: ArtifactRef,
  ctx: WorkerContext,
): Promise<ReadonlyArray<ArtifactRef>> {
  await wasmReady;
  const hasher = new StreamingBlake3();
  let offset = 0;
  for (;;) {
    throwIfAborted(ctx);
    const chunk = await opfs.readRange(artifactPath(input), offset, WINDOW);
    if (chunk.byteLength === 0) break;
    hasher.update(chunk);
    offset += chunk.byteLength;
    ctx.progress(Math.min(0.99, offset / (offset + WINDOW)));
  }
  const hex = hasher.finalize_hex();
  const out: ArtifactRef = {
    id: `hash/${input.id}`,
    type: "hash/blake3-hex",
    storage: "memory",
    hash: hex,
  };
  ctx.emitChunk(out, new TextEncoder().encode(hex));
  ctx.progress(1);
  return [out];
}

async function audioRms(
  input: ArtifactRef,
  ctx: WorkerContext,
): Promise<ReadonlyArray<ArtifactRef>> {
  await wasmReady;
  // 将输入按 f32le PCM 解释，分窗计算 RMS / Peak
  let offset = 0;
  let sumSquares = 0;
  let count = 0;
  let peak = 0;
  for (;;) {
    throwIfAborted(ctx);
    const chunk = await opfs.readRange(artifactPath(input), offset, WINDOW);
    if (chunk.byteLength < 4) break;
    const samples = new Float32Array(
      chunk.buffer.slice(0, chunk.byteLength - (chunk.byteLength % 4)),
    );
    const windowRms = rms_f32(samples);
    sumSquares += windowRms * windowRms * samples.length;
    count += samples.length;
    peak = Math.max(peak, peak_f32(samples));
    offset += chunk.byteLength;
    ctx.progress(Math.min(0.99, offset / (offset + WINDOW)));
  }
  const stats = { rms: count > 0 ? Math.sqrt(sumSquares / count) : 0, peak };
  const out: ArtifactRef = {
    id: `audio-stats/${input.id}`,
    type: "audio/stats",
    storage: "memory",
    format: "json",
  };
  ctx.emitChunk(out, new TextEncoder().encode(JSON.stringify(stats)));
  ctx.progress(1);
  return [out];
}

defineWorker({
  "hash.blake3": (task, ctx) => {
    const input = task.inputs[0];
    if (input === undefined) throw new Error("hash.blake3 requires an input");
    return hashBlake3(input, ctx);
  },
  "audio.rms": (task, ctx) => {
    const input = task.inputs[0];
    if (input === undefined) throw new Error("audio.rms requires an input");
    return audioRms(input, ctx);
  },
});
