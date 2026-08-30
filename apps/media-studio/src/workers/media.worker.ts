import { artifactPath, type ArtifactRef, type ComputeTask } from "@bcr/core";
import { defineWorker, type WorkerContext } from "@bcr/runtime-worker";
import { OpfsStore } from "@bcr/storage-opfs";
import init, { peak_f32 } from "../../../../crates/kernels/pkg/bcr_kernels.js";
import { alignTranslations, normalizeCues, type SegmentOptions } from "../subtitles";

/**
 * media.worker（Subtitle Studio）：音频理解链路的执行平面。
 *
 * 中间产物（asr-chunks / cues / bilingual）由 Worker 直写 OPFS（§4 huge 通道），
 * 事件里只带 ref——下游任务从 OPFS 读取，不经主线程。
 */

const opfs = new OpfsStore("media");
const WINDOW = 4 * 1024 * 1024;
const WAVEFORM_BUCKETS = 2048;
const SAMPLE_RATE = 16_000;

const wasmReady = init();

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * 按类型选输入：fan-out 的节点会收到兄弟输出（如 media/info），
 * operation 只声明自己关心的类型，不依赖输入顺序。
 */
function pickInput(task: ComputeTask, type: string): ArtifactRef | undefined {
  return task.inputs.find((ref) => ref.type === type);
}

function throwIfAborted(ctx: WorkerContext): void {
  if (ctx.signal.aborted) throw new Error("cancelled");
}

function configOf(task: ComputeTask): Record<string, unknown> {
  return task.config ?? {};
}

async function readWholeArtifact(input: ArtifactRef): Promise<Uint8Array> {
  const total = await opfs.size(artifactPath(input));
  if (total === undefined) throw new Error(`artifact not found: ${input.id}`);
  const out = new Uint8Array(total);
  let offset = 0;
  while (offset < total) {
    const chunk = await opfs.readRange(
      artifactPath(input),
      offset,
      Math.min(WINDOW, total - offset),
    );
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function writeArtifact(ref: ArtifactRef, bytes: Uint8Array): Promise<ArtifactRef> {
  await opfs.put(artifactPath(ref), bytes);
  return ref;
}

/** 读取 f32le PCM artifact → Float32Array。 */
async function readPcm(input: ArtifactRef): Promise<Float32Array> {
  const bytes = await readWholeArtifact(input);
  const aligned = bytes.byteLength - (bytes.byteLength % 4);
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + aligned);
  return new Float32Array(copy);
}

async function persistJson(ref: ArtifactRef, value: unknown): Promise<ArtifactRef> {
  return writeArtifact(ref, encoder.encode(JSON.stringify(value)));
}

async function readJson<T>(ref: ArtifactRef): Promise<T> {
  return JSON.parse(decoder.decode(await readWholeArtifact(ref))) as T;
}

// ── 波形（Rust peak kernel，按窗口流式读取 PCM） ─────────────────────

async function audioWaveform(
  input: ArtifactRef,
  ctx: WorkerContext,
): Promise<ReadonlyArray<ArtifactRef>> {
  await wasmReady;
  const total = (await opfs.size(artifactPath(input))) ?? 0;
  const window = total > 0 ? Math.max(64 * 1024, Math.ceil(total / WAVEFORM_BUCKETS)) : WINDOW;
  const peaks = new Float32Array(WAVEFORM_BUCKETS);
  let offset = 0;
  for (;;) {
    throwIfAborted(ctx);
    const chunk = await opfs.readRange(artifactPath(input), offset, window);
    if (chunk.byteLength < 4) break;
    const usable = chunk.byteLength - (chunk.byteLength % 4);
    const samples = new Float32Array(
      chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + usable),
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
  const out: ArtifactRef = {
    id: `waveform/${input.id}`,
    type: "audio/waveform-peaks",
    // 与 decode 的 info 同理：缓存引用跨刷新存活，peaks 直写 OPFS（§4）
    storage: "opfs",
    format: "f32le",
  };
  await opfs.put(artifactPath(out), new Uint8Array(peaks.buffer));
  ctx.progress(1);
  return [out];
}

// ── ASR（transformers.js Whisper；不可用时回退演示引擎） ─────────────

interface AsrChunk {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

interface AsrResult {
  readonly engine: "whisper" | "demo";
  readonly model: string;
  readonly chunks: ReadonlyArray<AsrChunk>;
}

/** 演示引擎：能量（RMS）检测语音段，占位文本。保证离线全链路可演示。 */
function demoChunks(samples: Float32Array, sampleRate: number): AsrChunk[] {
  const windowS = 0.25;
  const windowLen = Math.max(1, Math.floor(sampleRate * windowS));
  const windows = Math.floor(samples.length / windowLen);
  const rms: number[] = [];
  for (let w = 0; w < windows; w += 1) {
    let sum = 0;
    for (let i = 0; i < windowLen; i += 1) {
      const v = samples[w * windowLen + i] ?? 0;
      sum += v * v;
    }
    rms.push(Math.sqrt(sum / windowLen));
  }
  const peak = Math.max(0.01, ...rms);
  const threshold = peak * 0.12;
  const durationS = samples.length / sampleRate;

  const segments: Array<{ start: number; end: number }> = [];
  let open: number | undefined;
  for (let w = 0; w < windows; w += 1) {
    const t = w * windowS;
    if ((rms[w] ?? 0) > threshold) {
      open ??= t;
    } else if (open !== undefined) {
      if (t - open >= 0.4) segments.push({ start: open, end: t });
      open = undefined;
    }
  }
  if (open !== undefined) segments.push({ start: open, end: durationS });

  // 合并间隔 < 0.4s 的相邻段，限制单段 ≤ 4s
  const merged: Array<{ start: number; end: number }> = [];
  for (const segment of segments) {
    const prev = merged[merged.length - 1];
    if (prev !== undefined && segment.start - prev.end < 0.4) {
      prev.end = Math.min(prev.start + 4, segment.end);
      continue;
    }
    merged.push({ ...segment });
  }
  if (merged.length === 0) {
    merged.push({ start: 0, end: Math.min(3, durationS) });
  }
  return merged.map((segment, index) => ({
    start: segment.start,
    end: segment.end,
    text: `（演示字幕 ${index + 1}）`,
  }));
}

type Transcriber = (
  audio: Float32Array,
  options: Record<string, unknown>,
) => Promise<{
  text: string;
  chunks?: Array<{ timestamp: [number, number | null]; text: string }>;
}>;

let transcriberCache: { model: string; task: string; fn: Transcriber } | undefined;

async function loadTranscriber(
  model: string,
  task: "transcribe" | "translate",
  ctx: WorkerContext,
): Promise<Transcriber> {
  const cached = transcriberCache;
  if (cached !== undefined && cached.model === model && cached.task === task) return cached.fn;

  const { pipeline, env } = await import("@huggingface/transformers");
  env.allowLocalModels = false;
  ctx.progress(0.02);
  const fn = (await pipeline("automatic-speech-recognition", model, {
    dtype: "q8",
    progress_callback: (info: { status?: string; progress?: number }) => {
      if (info.status === "progress" && typeof info.progress === "number") {
        ctx.progress(Math.min(0.35, 0.02 + (info.progress / 100) * 0.33));
      }
    },
  })) as unknown as Transcriber;
  ctx.progress(0.4);
  transcriberCache = { model, task, fn };
  return fn;
}

async function whisperChunks(
  samples: Float32Array,
  model: string,
  task: "transcribe" | "translate",
  ctx: WorkerContext,
): Promise<AsrChunk[]> {
  const transcriber = await loadTranscriber(model, task, ctx);
  const result = await transcriber(samples, {
    // whisper 的 transcribe/translate 是 generation 参数（多语言模型）
    task,
    return_timestamps: true,
    chunk_length_s: 30,
    stride_length_s: 5,
  });
  ctx.progress(0.95);
  const raw = result.chunks ?? [{ timestamp: [0, null], text: result.text }];
  return raw.flatMap((chunk) => {
    const text = chunk.text.trim();
    if (text.length === 0) return [];
    const start = chunk.timestamp[0] ?? 0;
    const end = chunk.timestamp[1] ?? samples.length / SAMPLE_RATE;
    return [{ start, end: Math.max(end, start + 0.2), text }];
  });
}

async function asrTranscribe(
  task: ComputeTask,
  ctx: WorkerContext,
): Promise<ReadonlyArray<ArtifactRef>> {
  const input = pickInput(task, "audio/pcm-f32");
  if (input === undefined) throw new Error("asr.transcribe requires a pcm-f32 input");
  const config = configOf(task);
  const model = typeof config["model"] === "string" ? config["model"] : "Xenova/whisper-tiny";
  const engine =
    config["engine"] === "whisper" || config["engine"] === "demo" ? config["engine"] : "auto";

  const samples = await readPcm(input);
  ctx.progress(0.05);

  let result: AsrResult;
  if (engine === "demo") {
    result = { engine: "demo", model: "demo", chunks: demoChunks(samples, SAMPLE_RATE) };
  } else {
    try {
      const chunks = await whisperChunks(samples, model, "transcribe", ctx);
      result = { engine: "whisper", model, chunks };
    } catch (error) {
      if (engine === "whisper") throw error;
      console.warn("[asr] whisper unavailable, falling back to demo engine:", error);
      result = { engine: "demo", model: "demo", chunks: demoChunks(samples, SAMPLE_RATE) };
    }
  }

  const out: ArtifactRef = {
    id: `asr/${input.id}/${result.engine}/${result.model}`,
    type: "subtitle/asr-chunks",
    storage: "opfs",
    format: "json",
  };
  await persistJson(out, result);
  ctx.progress(1);
  return [out];
}

// ── 字幕规范化 ───────────────────────────────────────────────────────

async function subtitleSegment(
  task: ComputeTask,
  ctx: WorkerContext,
): Promise<ReadonlyArray<ArtifactRef>> {
  const input = pickInput(task, "subtitle/asr-chunks");
  if (input === undefined) throw new Error("subtitle.segment requires an asr-chunks input");
  const config = configOf(task);
  const options: SegmentOptions = {
    maxDurationS: typeof config["maxDurationS"] === "number" ? config["maxDurationS"] : 5,
    maxChars: typeof config["maxChars"] === "number" ? config["maxChars"] : 30,
  };
  const asr = await readJson<AsrResult>(input);
  const cues = normalizeCues(asr.chunks, options);
  const out: ArtifactRef = {
    id: `cues/${input.id}/${options.maxChars}c${options.maxDurationS}s`,
    type: "subtitle/cues",
    storage: "opfs",
    format: "json",
  };
  await persistJson(out, { cues });
  ctx.progress(1);
  return [out];
}

// ── 翻译（Whisper translate 二次推理 → 双语对齐） ─────────────────────

async function subtitleTranslate(
  task: ComputeTask,
  ctx: WorkerContext,
): Promise<ReadonlyArray<ArtifactRef>> {
  const pcmRef = pickInput(task, "audio/pcm-f32");
  const cuesRef = pickInput(task, "subtitle/cues");
  if (pcmRef === undefined || cuesRef === undefined) {
    throw new Error("subtitle.translate requires [pcm-f32, cues] inputs");
  }
  const config = configOf(task);
  const model = typeof config["model"] === "string" ? config["model"] : "Xenova/whisper-tiny";

  const samples = await readPcm(pcmRef);
  ctx.progress(0.05);
  const { cues } = await readJson<{ cues: ReturnType<typeof normalizeCues> }>(cuesRef);
  const translated = await whisperChunks(samples, model, "translate", ctx);
  const bilingual = alignTranslations(cues, translated);

  const out: ArtifactRef = {
    id: `bilingual/${cuesRef.id}/${model}`,
    type: "subtitle/cues",
    storage: "opfs",
    format: "json",
  };
  await persistJson(out, { cues: bilingual });
  ctx.progress(1);
  return [out];
}

defineWorker({
  "audio.waveform": (task, ctx) => {
    const input = pickInput(task, "audio/pcm-f32");
    if (input === undefined) throw new Error("audio.waveform requires a pcm-f32 input");
    return audioWaveform(input, ctx);
  },
  "asr.transcribe": (task, ctx) => asrTranscribe(task, ctx),
  "subtitle.segment": (task, ctx) => subtitleSegment(task, ctx),
  "subtitle.translate": (task, ctx) => subtitleTranslate(task, ctx),
});
