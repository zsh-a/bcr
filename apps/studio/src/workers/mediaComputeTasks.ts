import { artifactPath, contentHash, type ArtifactRef } from "@bcr/core";
import type { WorkerContext } from "@bcr/runtime-worker";
import init, { peak_f32, StreamingBlake3 } from "../../../../crates/kernels/pkg/bcr_kernels.js";
import { opfs, sizeOf, throwIfAborted, WINDOW } from "./computeShared";

const WAVEFORM_BUCKETS = 2048;
const wasmReady = init();

export async function hashBlake3(
  task: { config?: Record<string, unknown> | undefined },
  input: ArtifactRef,
  ctx: WorkerContext,
): Promise<ReadonlyArray<ArtifactRef>> {
  await wasmReady;
  const total = sizeOf(task);
  const hasher = new StreamingBlake3();
  let offset = 0;
  for (;;) {
    throwIfAborted(ctx);
    const chunk = await opfs.readRange(artifactPath(input), offset, WINDOW);
    if (chunk.byteLength === 0) break;
    hasher.update(chunk);
    offset += chunk.byteLength;
    if (total > 0) ctx.progress(Math.min(0.99, offset / total));
  }
  const hex = hasher.finalize_hex();
  const bytes = new TextEncoder().encode(hex);
  const out: ArtifactRef = {
    id: `hash/${hex}`,
    type: "hash/blake3-hex",
    storage: "opfs",
    hash: hex,
  };
  await opfs.put(artifactPath(out), bytes);
  ctx.progress(1);
  return [out];
}

/** 波形提取：按 f32le PCM 分窗，折叠为 2048 桶峰值包络。 */
export async function audioWaveform(
  task: { config?: Record<string, unknown> | undefined },
  input: ArtifactRef,
  ctx: WorkerContext,
): Promise<ReadonlyArray<ArtifactRef>> {
  await wasmReady;
  const total = sizeOf(task);
  // 自适应窗口：每桶至少覆盖一个窗口；小文件用 64KB 细窗，大文件按桶均分
  const window = total > 0 ? Math.max(64 * 1024, Math.ceil(total / WAVEFORM_BUCKETS)) : WINDOW;
  const peaks = new Float32Array(WAVEFORM_BUCKETS);
  let offset = 0;
  for (;;) {
    throwIfAborted(ctx);
    const chunk = await opfs.readRange(artifactPath(input), offset, window);
    if (chunk.byteLength < 4) break;
    const samples = new Float32Array(
      chunk.buffer.slice(0, chunk.byteLength - (chunk.byteLength % 4)),
    );
    const windowPeak = peak_f32(samples);
    if (total > 0) {
      const from = Math.floor((offset / total) * WAVEFORM_BUCKETS);
      const to = Math.min(
        WAVEFORM_BUCKETS - 1,
        Math.floor(((offset + chunk.byteLength) / total) * WAVEFORM_BUCKETS),
      );
      for (let i = from; i <= to; i += 1) {
        peaks[i] = Math.max(peaks[i] ?? 0, windowPeak);
      }
    }
    offset += chunk.byteLength;
    if (total > 0) ctx.progress(Math.min(0.99, offset / total));
  }
  const bytes = new Uint8Array(peaks.buffer);
  const hash = contentHash(bytes);
  const out: ArtifactRef = {
    id: `waveform/${hash}`,
    type: "audio/waveform-peaks",
    storage: "opfs",
    format: "f32le",
    hash,
  };
  // Studio 声明支持跨刷新缓存命中，因此小产物也必须持久化，不能只留在 memory store。
  await opfs.put(artifactPath(out), bytes);
  ctx.progress(1);
  return [out];
}
