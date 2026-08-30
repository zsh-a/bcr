import { artifactPath, type ArtifactRef, type ComputeTask } from "@bcr/core";
import { defineWorker, type WorkerContext } from "@bcr/runtime-worker";
import { OpfsStore } from "@bcr/storage-opfs";
import init, { peak_f32 } from "../../../../crates/kernels/pkg/bcr_kernels.js";
import {
  assignWords,
  groupWordsToChunks,
  normalizeCues,
  type CueWord,
  type SegmentOptions,
} from "../subtitles";
import { ownedChunks, planSampleWindows } from "../windows";

/**
 * media.worker（Subtitle Studio）：音频理解链路的执行平面。
 *
 * 中间产物（asr-chunks / cues / bilingual）由 Worker 直写 OPFS（§4 huge 通道），
 * 事件里只带 ref——下游任务从 OPFS 读取，不经主线程。
 * ASR / translate 按窗口切片推理：进度按窗推进、可中途取消、
 * 每窗完成即发 chunk 事件渐进回填 UI，Worker 内存只驻留一个窗口的 PCM。
 */

const opfs = new OpfsStore("media");
const WINDOW = 4 * 1024 * 1024;
const WAVEFORM_BUCKETS = 2048;
const SAMPLE_RATE = 16_000;
/** ASR 分窗参数：窗口长与边界重叠（秒）。 */
const ASR_WINDOW_S = 120;
const ASR_STRIDE_S = 4;

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

/** 按采样区间读取 PCM 窗口（§4：Worker 内存只驻留一个窗口）。 */
async function readPcmWindow(
  input: ArtifactRef,
  startSample: number,
  countSamples: number,
): Promise<Float32Array> {
  const bytes = await opfs.readRange(artifactPath(input), startSample * 4, countSamples * 4);
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
  /** 词级时间戳（whisper return_timestamps:"word"）；卡拉 OK 导出用。 */
  readonly words?: ReadonlyArray<CueWord>;
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

type Translator = (
  texts: ReadonlyArray<string>,
) => Promise<ReadonlyArray<{ translation_text: string }>>;

type Device = "auto" | "webgpu" | "wasm";
type ResolvedDevice = "webgpu" | "wasm";

/** WebGPU 探测（§10.1）：adapter 不可用由上层装载失败兜底降级。 */
function gpuAvailable(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

async function resolveDevice(device: Device): Promise<ResolvedDevice> {
  if (device === "wasm") return "wasm";
  if (!gpuAvailable()) {
    if (device === "webgpu") throw new Error("WebGPU is not available in this browser");
    return "wasm";
  }
  return "webgpu";
}

const WHISPER_OPTIONS: Record<string, unknown> = {
  dtype: "q8",
};

/** WebGPU 走 fp32 encoder + q4 decoder（transformers.js 官方 whisper 配置）。 */
const WHISPER_WEBGPU_OPTIONS: Record<string, unknown> = {
  device: "webgpu",
  dtype: { encoder_model: "fp32", decoder_model_merged: "q4" },
};

let transcriberCache:
  | { model: string; task: string; device: ResolvedDevice; fn: Transcriber }
  | undefined;

async function buildTranscriber(
  model: string,
  device: ResolvedDevice,
  ctx: WorkerContext,
): Promise<Transcriber> {
  const { pipeline, env } = await import("@huggingface/transformers");
  env.allowLocalModels = false;
  ctx.progress(0.02);
  const fn = (await pipeline("automatic-speech-recognition", model, {
    ...(device === "webgpu" ? WHISPER_WEBGPU_OPTIONS : WHISPER_OPTIONS),
    progress_callback: (info: { status?: string; progress?: number }) => {
      if (info.status === "progress" && typeof info.progress === "number") {
        ctx.progress(Math.min(0.35, 0.02 + (info.progress / 100) * 0.33));
      }
    },
  })) as unknown as Transcriber;
  ctx.progress(0.4);
  return fn;
}

/**
 * 装载 Whisper：device 解析 + §10.1 降级（auto：WebGPU 装载失败静默回退 WASM；
 * 显式选择失败则报错，让用户知情）。
 */
async function loadTranscriber(
  model: string,
  task: "transcribe",
  device: Device,
  ctx: WorkerContext,
): Promise<Transcriber> {
  const cached = transcriberCache;
  if (
    cached !== undefined &&
    cached.model === model &&
    cached.task === task &&
    // auto：任意已装载设备可复用；显式指定则必须匹配
    (device === "auto" || cached.device === device)
  ) {
    return cached.fn;
  }

  const resolved = await resolveDevice(device);
  try {
    const fn = await buildTranscriber(model, resolved, ctx);
    transcriberCache = { model, task, device: resolved, fn };
    return fn;
  } catch (error) {
    if (device === "auto" && resolved === "webgpu") {
      console.warn("[asr] WebGPU unavailable, falling back to WASM:", error);
      const fn = await buildTranscriber(model, "wasm", ctx);
      transcriberCache = { model, task, device: "wasm", fn };
      return fn;
    }
    throw error;
  }
}

async function whisperChunks(
  samples: Float32Array,
  model: string,
  ctx: WorkerContext,
  device: Device,
  offsetS = 0,
  wordTimestamps = false,
  language = "auto",
): Promise<AsrChunk[]> {
  const transcriber = await loadTranscriber(model, "transcribe", device, ctx);
  const result = await transcriber(samples, {
    // 未指定语言时 whisper 默认 en（transformers.js 不做自动检测）
    ...(language !== "auto" ? { language } : {}),
    return_timestamps: wordTimestamps ? "word" : true,
    chunk_length_s: 30,
    stride_length_s: 5,
  });
  const raw = result.chunks ?? [{ timestamp: [0, null], text: result.text }];
  const localWords: CueWord[] = [];
  const sentenceChunks: AsrChunk[] = [];
  for (const chunk of raw) {
    const text = chunk.text.trim();
    if (text.length === 0) continue;
    const start = (chunk.timestamp[0] ?? 0) + offsetS;
    const end = (chunk.timestamp[1] ?? samples.length / SAMPLE_RATE) + offsetS;
    const safeEnd = Math.max(end, start + 0.2);
    if (wordTimestamps) {
      // 词级：平铺词序列，本地暂存后聚合成条
      localWords.push({ start, end: safeEnd, text });
    } else {
      sentenceChunks.push({ start, end: safeEnd, text });
    }
  }
  if (!wordTimestamps) return sentenceChunks;

  return groupWordsToChunks(localWords).map((group) => ({
    start: group.start,
    end: group.end,
    text: group.text,
    words: group.words.map((word) => ({
      ...word,
    })),
  }));
}

/**
 * 分窗推理：每窗 PCM 按需从 OPFS 读取（内存只驻留一窗），
 * 进度按窗推进，取消在窗间生效；onPartial 每窗回调（transcribe 渐进回填 UI）。
 * 引擎解析：auto 先探装 whisper（失败一次性降级 demo）。
 */
async function windowedAsr(
  input: ArtifactRef,
  options: {
    readonly model: string;
    readonly engine: "auto" | "whisper" | "demo";
    readonly device: Device;
    readonly wordTimestamps: boolean;
    readonly language: string;
  },
  ctx: WorkerContext,
  onPartial?: (result: AsrResult) => void,
): Promise<AsrResult> {
  const totalBytes = await opfs.size(artifactPath(input));
  if (totalBytes === undefined) throw new Error(`artifact not found: ${input.id}`);
  const totalSamples = Math.floor(totalBytes / 4);
  const windows = planSampleWindows(
    totalSamples,
    ASR_WINDOW_S * SAMPLE_RATE,
    ASR_STRIDE_S * SAMPLE_RATE,
  );
  if (windows.length === 0) throw new Error("pcm artifact is empty");

  // 引擎探测：whisper 模型装载失败时一次性降级（推理中失败不再降级）
  let engine: "whisper" | "demo";
  if (options.engine === "demo") {
    engine = "demo";
  } else {
    try {
      await loadTranscriber(options.model, "transcribe", options.device, ctx);
      engine = "whisper";
    } catch (error) {
      if (options.engine === "whisper") throw error;
      console.warn("[asr] whisper unavailable, falling back to demo engine:", error);
      engine = "demo";
    }
  }
  const model = engine === "demo" ? "demo" : options.model;

  const owned: AsrChunk[] = [];
  for (let i = 0; i < windows.length; i += 1) {
    throwIfAborted(ctx);
    const window = windows[i] ?? { start: 0, end: 0, ownEnd: 0 };
    const samples = await readPcmWindow(input, window.start, window.end - window.start);

    let chunks: AsrChunk[];
    if (engine === "demo") {
      // demo 引擎输出窗口相对时间，与 whisper 路径一样补全局偏移
      const offsetS = window.start / SAMPLE_RATE;
      chunks = demoChunks(samples, SAMPLE_RATE).map((chunk) => ({
        ...chunk,
        start: chunk.start + offsetS,
        end: chunk.end + offsetS,
      }));
    } else {
      chunks = await whisperChunks(
        samples,
        model,
        ctx,
        options.device,
        window.start / SAMPLE_RATE,
        options.wordTimestamps,
        options.language,
      );
    }
    owned.push(...ownedChunks(chunks, window.start / SAMPLE_RATE, window.ownEnd / SAMPLE_RATE));
    ctx.progress(Math.min(0.98, 0.35 + (0.63 * (i + 1)) / windows.length));
    onPartial?.({ engine, model, chunks: [...owned] });
  }
  return { engine, model, chunks: owned };
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
  const device =
    config["device"] === "webgpu" || config["device"] === "wasm" ? config["device"] : "auto";
  // 词级时间戳：默认开启（卡拉 OK 导出；模型输出为平铺词序列，segment 前聚合）
  const words = config["words"] !== false;
  // 音频语言：transformers.js 未指定时默认 en（不自动检测），非英语素材必须显式选择
  const language = typeof config["language"] === "string" ? config["language"] : "auto";

  // 渐进回填：每窗归属 chunks 发 chunk 事件，主线程按 ref 读取增量渲染
  const partialRef: ArtifactRef = {
    id: `asr-partial/${task.id}`,
    type: "subtitle/asr-partial",
    storage: "memory",
    format: "json",
  };
  const result = await windowedAsr(
    input,
    { model, engine, device, wordTimestamps: words, language },
    ctx,
    (partial) => {
      ctx.emitChunk(partialRef, encoder.encode(JSON.stringify(partial)));
    },
  );

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
  const allWords = asr.chunks.flatMap((chunk) => chunk.words ?? []);
  const cues = assignWords(normalizeCues(asr.chunks, options), allWords);
  const out: ArtifactRef = {
    id: `cues/${input.id}/${options.maxChars}c${options.maxDurationS}s`,
    type: "subtitle/cues",
    storage: "opfs",
    format: "json",
  };
  // engine 透传：顶栏徽标如实显示识别引擎（demo / whisper）
  await persistJson(out, { cues, engine: asr.engine });
  ctx.progress(1);
  return [out];
}

// ── 翻译（opus-mt 文本翻译：逐条 cue 批量平移，1:1 对齐，无二次音频推理） ──

let translatorCache: { model: string; fn: Translator } | undefined;

async function loadTranslator(model: string, ctx: WorkerContext): Promise<Translator> {
  const cached = translatorCache;
  if (cached !== undefined && cached.model === model) return cached.fn;
  const { pipeline, env } = await import("@huggingface/transformers");
  env.allowLocalModels = false;
  ctx.progress(0.02);
  const fn = (await pipeline("translation", model, {
    dtype: "q8",
    progress_callback: (info: { status?: string; progress?: number }) => {
      if (info.status === "progress" && typeof info.progress === "number") {
        ctx.progress(Math.min(0.35, 0.02 + (info.progress / 100) * 0.33));
      }
    },
  })) as unknown as Translator;
  ctx.progress(0.4);
  translatorCache = { model, fn };
  return fn;
}

async function subtitleTranslate(
  task: ComputeTask,
  ctx: WorkerContext,
): Promise<ReadonlyArray<ArtifactRef>> {
  const cuesRef = pickInput(task, "subtitle/cues");
  if (cuesRef === undefined) {
    throw new Error("subtitle.translate requires a cues input");
  }
  const config = configOf(task);
  // 翻译方向 → opus-mt 模型（参与缓存键）
  const direction = config["direction"] === "zh-en" ? "zh-en" : "en-zh";
  const model = `Xenova/opus-mt-${direction}`;

  const { cues } = await readJson<{ cues: ReturnType<typeof normalizeCues> }>(cuesRef);
  const translator = await loadTranslator(model, ctx);

  // 分批翻译：模型一次吃一批，进度按批推进，批间可取消
  const texts = cues.map((cue) => cue.text);
  const BATCH = 16;
  const translations: string[] = [];
  for (let offset = 0; offset < texts.length; offset += BATCH) {
    throwIfAborted(ctx);
    const batch = texts.slice(offset, offset + BATCH);
    const results = await translator(batch);
    for (const result of results) {
      translations.push(result.translation_text.trim());
    }
    ctx.progress(Math.min(0.98, 0.4 + (0.58 * translations.length) / Math.max(1, texts.length)));
  }

  const bilingual = cues.map((cue, index) => {
    const translation = translations[index];
    return translation !== undefined && translation.length > 0 ? { ...cue, translation } : cue;
  });

  const out: ArtifactRef = {
    id: `bilingual/${cuesRef.id}/${model}`,
    type: "subtitle/cues",
    storage: "opfs",
    format: "json",
  };
  await persistJson(out, { cues: bilingual, engine: `opus-mt-${direction}` });
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
