import { artifactPath, contentHash, type ArtifactRef } from "@bcr/core";
import {
  createDocumentContentPackage,
  decodeDocumentContentPackage,
  createDocumentTranslationPackage,
  decodeDocumentTranslationPackage,
  type DocumentContentPackage,
  type DocumentFormat,
  type DocumentTranslationBlock,
  type DocumentTranslationPackage,
} from "@bcr/document-core";
import { applyGlossaryTerms } from "@bcr/manga-studio/glossary";
import {
  mangaWebGpuAvailable,
  decodeMangaOcrArtifact,
  resolveMangaCleanMode,
  resolveMangaDevice,
  resolveMangaOcrAdapter,
  resolveMangaTranslationAdapter,
  TRANSLATION_MODEL_MANIFESTS,
  type MangaAdapterExecution,
  type MangaCleanArtifact,
  type MangaCleanRegionMask,
  type MangaGlossaryEntry,
  type MangaOcrAdapterId,
  type MangaOcrArtifact,
  type MangaOcrLine,
  type MangaSourceLanguage,
  type MangaTranslationArtifact,
  type MangaTranslationLine,
} from "@bcr/manga-studio/model";
import { defineWorker, type WorkerContext } from "@bcr/runtime-worker";
import { OpfsStore } from "@bcr/storage-opfs";
import init, { peak_f32, StreamingBlake3 } from "../../../../crates/kernels/pkg/bcr_kernels.js";

/**
 * compute.worker（架构文档 §5）：Worker 内加载 Rust WASM kernel。
 * 大文件按 4MB 窗口从 OPFS 流动读取（§4），禁止整段装载。
 */

const WINDOW = 4 * 1024 * 1024;
const WAVEFORM_BUCKETS = 2048;
const opfs = new OpfsStore("studio");

const wasmReady = init();

function throwIfAborted(ctx: WorkerContext): void {
  if (ctx.signal.aborted) throw new Error("cancelled");
}

function sizeOf(task: { config?: Record<string, unknown> | undefined }): number {
  const size = task.config?.["sizeBytes"];
  return typeof size === "number" && size > 0 ? size : 0;
}

async function hashBlake3(
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
async function audioWaveform(
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

interface ExtractedSection {
  readonly id: string;
  readonly order: number;
  readonly label: string;
  readonly text: string;
}

function configString(task: { config?: Record<string, unknown> | undefined }, key: string): string {
  const value = task.config?.[key];
  return typeof value === "string" ? value : "";
}

function documentFormat(value: string): DocumentFormat {
  return value === "txt" ||
    value === "markdown" ||
    value === "html" ||
    value === "docx" ||
    value === "fb2" ||
    value === "epub" ||
    value === "pdf" ||
    value === "cbz" ||
    value === "image"
    ? value
    : "unknown";
}

function stripMarkup(raw: string): string {
  return raw
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
    .replace(/<br\s*\/?\s*>/giu, "\n")
    .replace(/<\/(?:p|div|section|article|title|h[1-6])\s*>/giu, "\n\n")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'");
}

function extractSections(raw: string, format: string): ReadonlyArray<ExtractedSection> {
  const normalized = (format === "html" || format === "fb2" ? stripMarkup(raw) : raw)
    .replace(/\r\n?/gu, "\n")
    .trim();
  const blocks = normalized
    .split(/\n{2,}/u)
    .map((block) => block.trim())
    .filter(Boolean);
  const sourceBlocks = blocks.length > 0 ? blocks : [normalized || "暂无内容"];
  return sourceBlocks.map((text, order) => {
    const markdownHeading = /^(?:#{1,6})\s+(.+)$/u.exec(text);
    const label =
      markdownHeading?.[1]?.trim() || `${format === "txt" ? "段落" : "Section"} ${order + 1}`;
    return { id: `section-${order + 1}`, order, label, text };
  });
}

/** Text/HTML/FB2 extraction: streamed source read → immutable JSON artifact. */
async function documentExtract(
  task: { inputs: ReadonlyArray<ArtifactRef>; config?: Record<string, unknown> | undefined },
  ctx: WorkerContext,
): Promise<ReadonlyArray<ArtifactRef>> {
  const input = task.inputs.find((ref) => ref.port === "source") ?? task.inputs[0];
  if (input === undefined) throw new Error("document.extract requires a source artifact");
  const total = sizeOf(task);
  const decoder = new TextDecoder();
  let raw = "";
  let offset = 0;
  for (;;) {
    throwIfAborted(ctx);
    const chunk = await opfs.readRange(artifactPath(input), offset, WINDOW);
    if (chunk.byteLength === 0) break;
    raw += decoder.decode(chunk, { stream: true });
    offset += chunk.byteLength;
    if (total > 0) ctx.progress(Math.min(0.92, offset / total));
  }
  raw += decoder.decode();
  const format = documentFormat(configString(task, "format"));
  const sourceName = configString(task, "sourceName") || input.id;
  const payload = createDocumentContentPackage({
    id: `document-content/${input.hash ?? input.id}`,
    format,
    sourceName,
    sourceRef: input,
    sourceHash: input.hash,
    adapter: "text.extract",
    blocks: extractSections(raw, format).map((section) => ({
      ...section,
      kind: /^(?:#{1,6})\s+/u.test(section.text) ? ("heading" as const) : ("paragraph" as const),
    })),
  });
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const hash = contentHash(bytes);
  const out: ArtifactRef = {
    id: `document/extract/${hash}`,
    type: "document/content-package",
    storage: "opfs",
    format: "json",
    hash,
  };
  await opfs.put(artifactPath(out), bytes);
  ctx.progress(1);
  return [out];
}

interface TypesetSection extends DocumentTranslationBlock {
  readonly lineCount: number;
  readonly overflow: boolean;
}

interface TypesetDocument {
  readonly version: 1;
  readonly adapter: "preview.typeset";
  readonly sourceContentId: string;
  readonly sourceName: string;
  readonly targetLanguage: string;
  readonly blocks: ReadonlyArray<TypesetSection>;
  readonly overflowCount: number;
}

async function readJsonArtifact<T>(ref: ArtifactRef, ctx: WorkerContext): Promise<T> {
  const chunks: Uint8Array[] = [];
  let offset = 0;
  for (;;) {
    throwIfAborted(ctx);
    const chunk = await opfs.readRange(artifactPath(ref), offset, WINDOW);
    if (chunk.byteLength === 0) break;
    chunks.push(chunk);
    offset += chunk.byteLength;
  }
  const bytes = new Uint8Array(offset);
  let cursor = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, cursor);
    cursor += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

async function readDocumentContentArtifact(
  ref: ArtifactRef,
  ctx: WorkerContext,
): Promise<DocumentContentPackage> {
  const decoded = decodeDocumentContentPackage(await readJsonArtifact<unknown>(ref, ctx));
  if (decoded === undefined) {
    throw new Error("document.extract Artifact 不是有效的 Content Package");
  }
  return decoded;
}

async function readDocumentTranslationArtifact(
  ref: ArtifactRef,
  ctx: WorkerContext,
): Promise<DocumentTranslationPackage> {
  const decoded = decodeDocumentTranslationPackage(await readJsonArtifact<unknown>(ref, ctx));
  if (decoded === undefined) {
    throw new Error("document.translate Artifact 不是有效的 Translation Package");
  }
  return decoded;
}

async function writeJsonArtifact(kind: string, payload: unknown): Promise<ArtifactRef> {
  return writeTypedJsonArtifact("document", kind, `document/${kind}`, payload);
}

async function writeTypedJsonArtifact(
  namespace: string,
  kind: string,
  type: string,
  payload: unknown,
): Promise<ArtifactRef> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const hash = contentHash(bytes);
  const out: ArtifactRef = {
    id: `${namespace}/${kind}/${hash}`,
    type,
    storage: "opfs",
    format: "json",
    hash,
  };
  await opfs.put(artifactPath(out), bytes);
  return out;
}

function configNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function configText(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function reviewOcrLines(task: { config?: Record<string, unknown> | undefined }): MangaOcrLine[] {
  const raw = task.config?.["regions"];
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((candidate, index) => {
    if (typeof candidate !== "object" || candidate === null) return [];
    const value = candidate as Record<string, unknown>;
    const id = configText(value["id"], `region-${index + 1}`);
    const label = configText(value["label"], `REVIEW ${String(index + 1).padStart(2, "0")}`);
    const confidence = Math.max(0, Math.min(1, configNumber(value["confidence"], 0)));
    return [
      {
        id,
        label,
        x: configNumber(value["x"], 0),
        y: configNumber(value["y"], 0),
        width: configNumber(value["width"], 0),
        height: configNumber(value["height"], 0),
        rotation: configNumber(value["rotation"], 0),
        writingMode: value["writingMode"] === "vertical-rl" ? "vertical-rl" : "horizontal-tb",
        text: configText(value["sourceText"], ""),
        confidence,
        status: "needs-review",
      } satisfies MangaOcrLine,
    ];
  });
}

/**
 * Review adapter: it does not inspect pixels. It persists the regions already
 * created by the human/fixture detector so review, order and translation can
 * consume a stable OCR contract while a real vision model is still optional.
 */
async function mangaOcrReview(
  task: { inputs: ReadonlyArray<ArtifactRef>; config?: Record<string, unknown> | undefined },
  ctx: WorkerContext,
): Promise<ReadonlyArray<ArtifactRef>> {
  const input = task.inputs.find((ref) => ref.port === "source") ?? task.inputs[0];
  if (input === undefined) throw new Error("manga.ocr.review requires a source artifact");
  const lines = reviewOcrLines(task);
  ctx.progress(0.2);
  const total = Math.max(1, lines.length);
  for (let index = 0; index < lines.length; index += 1) {
    throwIfAborted(ctx);
    ctx.progress(0.2 + ((index + 1) / total) * 0.65);
  }
  const payload: MangaOcrArtifact = {
    version: 1,
    adapter: "review.manual",
    sourceName: configText(task.config?.["sourceName"], input.id),
    coordinateSpace: "normalized-percent",
    lines,
    execution: {
      kind: "ocr",
      requestedAdapter:
        configText(task.config?.["requestedAdapter"], "review.manual") === "vision.onnx"
          ? "vision.onnx"
          : configText(task.config?.["requestedAdapter"], "review.manual") === "manga.onnx"
            ? "manga.onnx"
            : "review.manual",
      effectiveAdapter: "review.manual",
      runtime: "review",
      requestedDevice:
        configText(task.config?.["device"], "auto") === "webgpu"
          ? "webgpu"
          : configText(task.config?.["device"], "auto") === "wasm"
            ? "wasm"
            : "auto",
      effectiveDevice: "review",
      sourceLanguage:
        configText(task.config?.["sourceLanguage"], "ja") === "en"
          ? "en"
          : configText(task.config?.["sourceLanguage"], "ja") === "ko"
            ? "ko"
            : "ja",
      ...(configText(task.config?.["requestedAdapter"], "review.manual") === "review.manual"
        ? {}
        : { fallbackReason: "language-unsupported" as const }),
    },
  };
  const out = await writeTypedJsonArtifact("manga", "ocr-review", "manga/ocr-lines", payload);
  ctx.progress(1);
  return [out];
}

type OcrDevice = "auto" | "webgpu" | "wasm";
type ResolvedOcrDevice = "webgpu" | "wasm";
type OcrTranscriber = (image: unknown, options?: Record<string, unknown>) => Promise<unknown>;

interface LoadedModel<T> {
  readonly fn: T;
  readonly device: ResolvedOcrDevice;
  readonly fallbackReason?: "webgpu-unavailable" | "webgpu-init-failed";
}

function resolveOcrDevice(device: OcrDevice): {
  readonly device: ResolvedOcrDevice;
  readonly fallbackReason?: "webgpu-unavailable";
} {
  const resolved = resolveMangaDevice(device, mangaWebGpuAvailable());
  return {
    device: resolved.effectiveDevice,
    ...(resolved.fallbackReason === undefined ? {} : { fallbackReason: resolved.fallbackReason }),
  };
}

let ocrTranscriberCache:
  | {
      readonly model: string;
      readonly device: ResolvedOcrDevice;
      readonly fn: OcrTranscriber;
      readonly fallbackReason?: "webgpu-unavailable" | "webgpu-init-failed";
    }
  | undefined;

async function buildOcrTranscriber(
  model: string,
  device: ResolvedOcrDevice,
  ctx: WorkerContext,
): Promise<OcrTranscriber> {
  const { pipeline, env } = await import("@huggingface/transformers");
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  ctx.progress(0.02);
  const fn = (await pipeline("image-to-text", model, {
    ...(device === "webgpu" ? { device: "webgpu", dtype: "q8" } : { dtype: "q8" }),
    progress_callback: (info: { status?: string; progress?: number }) => {
      if (info.status === "progress" && typeof info.progress === "number") {
        ctx.progress(Math.min(0.35, 0.02 + (info.progress / 100) * 0.33));
      }
    },
  })) as unknown as OcrTranscriber;
  ctx.progress(0.4);
  return fn;
}

async function loadOcrTranscriber(
  model: string,
  device: OcrDevice,
  ctx: WorkerContext,
): Promise<LoadedModel<OcrTranscriber>> {
  const requested = resolveOcrDevice(device);
  const cached = ocrTranscriberCache;
  if (
    cached !== undefined &&
    cached.model === model &&
    (cached.device === device || (device === "auto" && cached.device === requested.device))
  ) {
    return {
      fn: cached.fn,
      device: cached.device,
      ...(device === "wasm" || cached.fallbackReason === undefined
        ? {}
        : { fallbackReason: cached.fallbackReason }),
    };
  }
  const resolved = requested;
  try {
    const fn = await buildOcrTranscriber(model, resolved.device, ctx);
    ocrTranscriberCache = {
      model,
      device: resolved.device,
      fn,
      ...(resolved.fallbackReason === undefined ? {} : { fallbackReason: resolved.fallbackReason }),
    };
    return {
      fn,
      device: resolved.device,
      ...(resolved.fallbackReason === undefined ? {} : { fallbackReason: resolved.fallbackReason }),
    };
  } catch (error) {
    if (resolved.device === "webgpu") {
      console.warn("[manga-ocr] WebGPU initialization failed, falling back to WASM:", error);
      const fn = await buildOcrTranscriber(model, "wasm", ctx);
      const loaded = { fn, device: "wasm" as const, fallbackReason: "webgpu-init-failed" as const };
      ocrTranscriberCache = { model, ...loaded };
      return loaded;
    }
    throw error;
  }
}

function generatedText(result: unknown): string {
  const first = Array.isArray(result) ? result[0] : result;
  if (typeof first !== "object" || first === null) return "";
  const text = (first as Record<string, unknown>)["generated_text"];
  return typeof text === "string" ? text.trim() : "";
}

function cropBounds(
  line: MangaOcrLine,
  width: number,
  height: number,
): [number, number, number, number] {
  const xMin = Math.max(0, Math.min(width - 1, Math.round((line.x / 100) * width)));
  const yMin = Math.max(0, Math.min(height - 1, Math.round((line.y / 100) * height)));
  const xMax = Math.max(
    xMin,
    Math.min(width - 1, xMin + Math.max(1, Math.round((line.width / 100) * width)) - 1),
  );
  const yMax = Math.max(
    yMin,
    Math.min(height - 1, yMin + Math.max(1, Math.round((line.height / 100) * height)) - 1),
  );
  return [xMin, yMin, xMax, yMax];
}

/**
 * Opt-in local OCR: the detector/region geometry remains explicit, while a
 * lazily loaded Transformers.js ONNX model recognizes each crop in the Worker.
 */
async function mangaOcrOnnx(
  task: { inputs: ReadonlyArray<ArtifactRef>; config?: Record<string, unknown> | undefined },
  ctx: WorkerContext,
): Promise<ReadonlyArray<ArtifactRef>> {
  const input = task.inputs.find((ref) => ref.port === "source") ?? task.inputs[0];
  if (input === undefined) throw new Error("manga.ocr.onnx requires a source artifact");
  const lines = reviewOcrLines(task);
  if (lines.length === 0) throw new Error("manga.ocr.onnx requires detected text regions");
  const model = configText(task.config?.["model"], "Xenova/trocr-small-printed");
  const deviceValue = configText(task.config?.["device"], "auto");
  const device: OcrDevice =
    deviceValue === "webgpu" || deviceValue === "wasm" ? deviceValue : "auto";
  const adapterValue = configText(task.config?.["adapter"], "vision.onnx");
  const requestedAdapterValue = configText(task.config?.["requestedAdapter"], adapterValue);
  const requestedAdapter: MangaOcrAdapterId =
    requestedAdapterValue === "manga.onnx" || requestedAdapterValue === "vision.onnx"
      ? requestedAdapterValue
      : "review.manual";
  const sourceLanguageValue = configText(task.config?.["sourceLanguage"], "ja");
  const sourceLanguage: MangaSourceLanguage =
    sourceLanguageValue === "en" || sourceLanguageValue === "ko" ? sourceLanguageValue : "ja";
  const resolution = resolveMangaOcrAdapter(requestedAdapter, sourceLanguage, {
    model,
    device,
  });
  if (resolution.execution.effectiveAdapter === "review.manual") {
    throw new Error(
      `manga.ocr.onnx cannot run ${requestedAdapter} for ${sourceLanguage}; use Review adapter`,
    );
  }
  const blob = await opfs.getBlob(artifactPath(input));
  if (blob === undefined) throw new Error(`artifact not found: ${input.id}`);
  const transformers = await import("@huggingface/transformers");
  const image = await transformers.RawImage.read(blob);
  const loaded = await loadOcrTranscriber(model, device, ctx);
  const transcriber = loaded.fn;
  const recognized: MangaOcrLine[] = [];
  for (const [index, line] of lines.entries()) {
    throwIfAborted(ctx);
    const crop = await image.crop(cropBounds(line, image.width, image.height));
    const text = generatedText(await transcriber(crop, { max_new_tokens: 128 }));
    recognized.push({
      ...line,
      text,
      // Image-to-text pipelines do not expose calibrated confidence. Keep the
      // line reviewable instead of inventing a score from model logits.
      confidence: text.length > 0 ? 0.5 : 0,
      status: "needs-review",
    });
    ctx.progress(Math.min(0.98, 0.4 + (0.58 * (index + 1)) / lines.length));
  }
  const adapter = resolution.execution.effectiveAdapter as Exclude<
    MangaOcrAdapterId,
    "review.manual"
  >;
  const execution: MangaAdapterExecution = {
    ...resolution.execution,
    effectiveDevice: loaded.device,
    ...(loaded.fallbackReason === undefined ? {} : { fallbackReason: loaded.fallbackReason }),
  };
  const payload: MangaOcrArtifact = {
    version: 1,
    adapter,
    sourceName: configText(task.config?.["sourceName"], input.id),
    coordinateSpace: "normalized-percent",
    lines: recognized,
    execution,
  };
  const out = await writeTypedJsonArtifact("manga", "ocr-onnx", "manga/ocr-lines", payload);
  ctx.progress(1);
  return [out];
}

type MangaTranslator = (
  text: string | ReadonlyArray<string>,
  options?: Record<string, unknown>,
) => Promise<unknown>;

let mangaTranslatorCache:
  | {
      readonly model: string;
      readonly device: ResolvedOcrDevice;
      readonly fn: MangaTranslator;
      readonly fallbackReason?: "webgpu-unavailable" | "webgpu-init-failed";
    }
  | undefined;

function defaultTranslationModel(sourceLanguage: MangaSourceLanguage): string {
  const manifest = TRANSLATION_MODEL_MANIFESTS.find((candidate) => candidate.id === "local");
  return manifest?.models[sourceLanguage] ?? "Xenova/nllb-200-distilled-600M";
}

function translationOptions(sourceLanguage: MangaSourceLanguage): Record<string, string> {
  return {
    src_lang:
      sourceLanguage === "ja" ? "jpn_Jpan" : sourceLanguage === "ko" ? "kor_Hang" : "eng_Latn",
    tgt_lang: "zho_Hans",
  };
}

async function buildMangaTranslator(
  model: string,
  device: ResolvedOcrDevice,
  ctx: WorkerContext,
): Promise<MangaTranslator> {
  const { pipeline, env } = await import("@huggingface/transformers");
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  ctx.progress(0.02);
  const fn = (await pipeline("translation", model, {
    ...(device === "webgpu" ? { device: "webgpu", dtype: "q8" } : { dtype: "q8" }),
    progress_callback: (info: { status?: string; progress?: number }) => {
      if (info.status === "progress" && typeof info.progress === "number") {
        ctx.progress(Math.min(0.35, 0.02 + (info.progress / 100) * 0.33));
      }
    },
  })) as unknown as MangaTranslator;
  ctx.progress(0.4);
  return fn;
}

async function loadMangaTranslator(
  model: string,
  device: OcrDevice,
  ctx: WorkerContext,
): Promise<LoadedModel<MangaTranslator>> {
  const requested = resolveOcrDevice(device);
  const cached = mangaTranslatorCache;
  if (
    cached !== undefined &&
    cached.model === model &&
    (cached.device === device || (device === "auto" && cached.device === requested.device))
  ) {
    return {
      fn: cached.fn,
      device: cached.device,
      ...(device === "wasm" || cached.fallbackReason === undefined
        ? {}
        : { fallbackReason: cached.fallbackReason }),
    };
  }
  const resolved = requested;
  try {
    const fn = await buildMangaTranslator(model, resolved.device, ctx);
    mangaTranslatorCache = {
      model,
      device: resolved.device,
      fn,
      ...(resolved.fallbackReason === undefined ? {} : { fallbackReason: resolved.fallbackReason }),
    };
    return {
      fn,
      device: resolved.device,
      ...(resolved.fallbackReason === undefined ? {} : { fallbackReason: resolved.fallbackReason }),
    };
  } catch (error) {
    if (resolved.device === "webgpu") {
      console.warn("[manga-translate] WebGPU initialization failed, falling back to WASM:", error);
      const fn = await buildMangaTranslator(model, "wasm", ctx);
      const loaded = { fn, device: "wasm" as const, fallbackReason: "webgpu-init-failed" as const };
      mangaTranslatorCache = { model, ...loaded };
      return loaded;
    }
    throw error;
  }
}

function taskGlossary(task: {
  config?: Record<string, unknown> | undefined;
}): MangaGlossaryEntry[] {
  const raw = task.config?.["glossary"];
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((candidate, index) => {
    if (typeof candidate !== "object" || candidate === null) return [];
    const value = candidate as Record<string, unknown>;
    if (typeof value["source"] !== "string" || typeof value["target"] !== "string") return [];
    const source = value["source"].trim();
    const target = value["target"].trim();
    if (source.length === 0 || target.length === 0) return [];
    return [
      {
        id: typeof value["id"] === "string" ? value["id"] : `task-glossary-${index}`,
        source,
        target,
        note: typeof value["note"] === "string" ? value["note"] : "",
        enabled: value["enabled"] !== false,
      } satisfies MangaGlossaryEntry,
    ];
  });
}

function translationTexts(result: unknown): string[] {
  const values = Array.isArray(result) ? result : [result];
  return values.map((value) => {
    if (typeof value !== "object" || value === null) return "";
    const text = (value as Record<string, unknown>)["translation_text"];
    return typeof text === "string" ? text.trim() : "";
  });
}

/** Opt-in local translation: read OCR lines, preserve IDs, and persist a reviewable artifact. */
async function mangaTranslateOnnx(
  task: { inputs: ReadonlyArray<ArtifactRef>; config?: Record<string, unknown> | undefined },
  ctx: WorkerContext,
): Promise<ReadonlyArray<ArtifactRef>> {
  const input = task.inputs.find((ref) => ref.port === "lines") ?? task.inputs[0];
  if (input === undefined) throw new Error("manga.translate.onnx requires OCR lines");
  const ocr = decodeMangaOcrArtifact(await readJsonArtifact<unknown>(input, ctx));
  const sourceLanguageValue = configText(task.config?.["sourceLanguage"], "ja");
  const sourceLanguage: MangaSourceLanguage =
    sourceLanguageValue === "en" || sourceLanguageValue === "ko" ? sourceLanguageValue : "ja";
  const targetLanguage = configText(task.config?.["targetLanguage"], "zh");
  if (targetLanguage !== "zh")
    throw new Error(`unsupported manga translation target: ${targetLanguage}`);
  const model = configText(task.config?.["model"], defaultTranslationModel(sourceLanguage));
  const deviceValue = configText(task.config?.["device"], "auto");
  const device: OcrDevice =
    deviceValue === "webgpu" || deviceValue === "wasm" ? deviceValue : "auto";
  const requestedDeviceResolution = resolveOcrDevice(device);
  const requestedAdapter: "fixture" | "local" =
    configText(task.config?.["requestedAdapter"], "local") === "fixture" ? "fixture" : "local";
  const resolution = resolveMangaTranslationAdapter(requestedAdapter, sourceLanguage, {
    model,
    device,
  });
  if (resolution.execution.effectiveAdapter !== "local") {
    throw new Error(`manga.translate.onnx cannot run ${requestedAdapter} without a local model`);
  }
  const glossary = taskGlossary(task);
  const translatable = ocr.lines.filter((line) => line.text.trim().length > 0);
  const translated = new Map<string, string>();
  const exact = new Map(
    glossary
      .filter(
        (entry) =>
          entry.enabled && entry.source.trim().length > 0 && entry.target.trim().length > 0,
      )
      .map((entry) => [entry.source.trim(), entry.target.trim()]),
  );
  const pending = translatable.filter((line) => !exact.has(line.text.trim()));
  let loaded: LoadedModel<MangaTranslator> | undefined;
  if (pending.length > 0) {
    loaded = await loadMangaTranslator(model, device, ctx);
    const translator = loaded.fn;
    const BATCH = 8;
    for (let offset = 0; offset < pending.length; offset += BATCH) {
      throwIfAborted(ctx);
      const batch = pending.slice(offset, offset + BATCH);
      const outputs = translationTexts(
        await translator(
          batch.map((line) => line.text),
          translationOptions(sourceLanguage),
        ),
      );
      for (const [index, line] of batch.entries()) {
        const output = outputs[index] ?? "";
        translated.set(line.id, applyGlossaryTerms(output, glossary));
      }
      ctx.progress(
        Math.min(
          0.98,
          0.4 +
            (0.58 * Math.min(pending.length, offset + batch.length)) / Math.max(1, pending.length),
        ),
      );
    }
  } else {
    ctx.progress(0.4);
  }
  const lines: MangaTranslationLine[] = ocr.lines.map((line) => ({
    id: line.id,
    sourceText: line.text,
    translatedText: exact.get(line.text.trim()) ?? translated.get(line.id) ?? "",
    status: "needs-review",
  }));
  const payload: MangaTranslationArtifact = {
    version: 1,
    adapter: "local.onnx",
    sourceName: configText(task.config?.["sourceName"], ocr.sourceName),
    sourceLanguage,
    targetLanguage: "zh",
    lines,
    execution: {
      ...resolution.execution,
      effectiveDevice: loaded?.device ?? requestedDeviceResolution.device,
      ...(loaded?.fallbackReason !== undefined
        ? { fallbackReason: loaded.fallbackReason }
        : requestedDeviceResolution.fallbackReason === undefined
          ? {}
          : { fallbackReason: requestedDeviceResolution.fallbackReason }),
    },
  };
  const out = await writeTypedJsonArtifact(
    "manga",
    "translate-onnx",
    "manga/translation-lines",
    payload,
  );
  ctx.progress(1);
  return [out];
}

function cleanRegionMasks(task: {
  config?: Record<string, unknown> | undefined;
}): MangaCleanRegionMask[] {
  const raw = task.config?.["regions"];
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((candidate) => {
    if (typeof candidate !== "object" || candidate === null) return [];
    const value = candidate as Record<string, unknown>;
    if (typeof value["id"] !== "string") return [];
    const number = (key: string): number => {
      const valueAtKey = value[key];
      return typeof valueAtKey === "number" && Number.isFinite(valueAtKey) ? valueAtKey : 0;
    };
    return [
      {
        id: value["id"],
        x: number("x"),
        y: number("y"),
        width: number("width"),
        height: number("height"),
        rotation: number("rotation"),
      },
    ];
  });
}

/** Safe cleaning preview: emit a mask contract and record explicit Inpaint fallback. */
async function mangaCleanPreview(
  task: { inputs: ReadonlyArray<ArtifactRef>; config?: Record<string, unknown> | undefined },
  ctx: WorkerContext,
): Promise<ReadonlyArray<ArtifactRef>> {
  const input = task.inputs.find((ref) => ref.port === "source") ?? task.inputs[0];
  if (input === undefined) throw new Error("manga.clean.preview requires a source artifact");
  throwIfAborted(ctx);
  ctx.progress(0.2);
  const requestedMode =
    configText(task.config?.["mode"], "fill") === "inpaint" ? "inpaint" : "fill";
  const resolved = resolveMangaCleanMode(requestedMode);
  const payload: MangaCleanArtifact = {
    version: 1,
    adapter: resolved.adapter,
    sourceName: configText(task.config?.["sourceName"], input.id),
    coordinateSpace: "normalized-percent",
    requestedMode: resolved.requestedMode,
    effectiveMode: resolved.effectiveMode,
    ...(resolved.fallbackReason === undefined ? {} : { fallbackReason: resolved.fallbackReason }),
    regions: cleanRegionMasks(task),
  };
  ctx.progress(0.8);
  const out = await writeTypedJsonArtifact("manga", "clean-preview", "manga/clean-page", payload);
  ctx.progress(1);
  return [out];
}

const fixtureDictionary: Readonly<Record<string, string>> = {
  "ここから、始めよう。": "就从这里开始吧。",
  もうすぐ春だね: "春天快到了呢",
  "見つけた！": "找到了！",
  静かな午後: "安静的午后",
  ページをめくる: "翻开下一页",
  "また明日。": "明天见。",
};

function fixtureTranslate(text: string): string {
  const normalized = text.replace(/\s+/gu, " ").trim();
  return (
    fixtureDictionary[normalized] ?? (normalized.length > 0 ? `待审校：${normalized}` : "待审校")
  );
}

async function documentTranslateFixture(
  task: { inputs: ReadonlyArray<ArtifactRef>; config?: Record<string, unknown> | undefined },
  ctx: WorkerContext,
): Promise<ReadonlyArray<ArtifactRef>> {
  const input = task.inputs.find((ref) => ref.port === "source") ?? task.inputs[0];
  if (input === undefined) throw new Error("document.translate requires a content package");
  const extracted = await readDocumentContentArtifact(input, ctx);
  ctx.progress(0.2);
  const blocks: DocumentTranslationBlock[] = [];
  for (const [index, section] of extracted.blocks.entries()) {
    throwIfAborted(ctx);
    blocks.push({
      ...section,
      translatedText: fixtureTranslate(section.text),
      status: "needs-review",
    });
    ctx.progress(0.2 + ((index + 1) / Math.max(1, extracted.blocks.length)) * 0.7);
  }
  const sourceLanguage = configString(task, "sourceLanguage") || extracted.metadata.language;
  const payload = createDocumentTranslationPackage({
    id: `translation/${extracted.id}/zh-Hans`,
    sourceContentId: extracted.id,
    sourceName: extracted.sourceName,
    format: extracted.format,
    ...(sourceLanguage === undefined ? {} : { sourceLanguage }),
    targetLanguage: configString(task, "targetLanguage") || "zh-Hans",
    metadata: extracted.metadata,
    sourceRef: input,
    blocks,
    adapter: "fixture.translate",
  });
  const out = await writeTypedJsonArtifact(
    "document",
    "translations",
    "document/translation-package",
    payload,
  );
  ctx.progress(1);
  return [out];
}

async function documentTypesetPreview(
  task: { inputs: ReadonlyArray<ArtifactRef> },
  ctx: WorkerContext,
): Promise<ReadonlyArray<ArtifactRef>> {
  const input = task.inputs.find((ref) => ref.port === "source") ?? task.inputs[0];
  if (input === undefined) throw new Error("document.typeset requires a translation package");
  const translated = await readDocumentTranslationArtifact(input, ctx);
  ctx.progress(0.2);
  const blocks: TypesetSection[] = translated.blocks.map((section) => {
    const lineCount = Math.max(1, Math.ceil(section.translatedText.length / 28));
    return { ...section, lineCount, overflow: lineCount > 4 };
  });
  const overflowCount = blocks.filter((section) => section.overflow).length;
  throwIfAborted(ctx);
  const out = await writeJsonArtifact("typeset-preview", {
    version: 1,
    adapter: "preview.typeset",
    sourceContentId: translated.sourceContentId,
    sourceName: translated.sourceName,
    targetLanguage: translated.targetLanguage,
    blocks,
    overflowCount,
  } satisfies TypesetDocument);
  ctx.progress(1);
  return [out];
}

defineWorker({
  "hash.blake3": (task, ctx) => {
    const input = task.inputs.find((ref) => ref.port === "source") ?? task.inputs[0];
    if (input === undefined) throw new Error("hash.blake3 requires an input");
    return hashBlake3(task, input, ctx);
  },
  "audio.waveform": (task, ctx) => {
    const input = task.inputs.find((ref) => ref.port === "source") ?? task.inputs[0];
    if (input === undefined) throw new Error("audio.waveform requires an input");
    return audioWaveform(task, input, ctx);
  },
  "document.extract": (task, ctx) => documentExtract(task, ctx),
  "document.translate.fixture": (task, ctx) => documentTranslateFixture(task, ctx),
  "document.typeset.preview": (task, ctx) => documentTypesetPreview(task, ctx),
  "manga.ocr.review": (task, ctx) => mangaOcrReview(task, ctx),
  "manga.ocr.onnx": (task, ctx) => mangaOcrOnnx(task, ctx),
  "manga.translate.onnx": (task, ctx) => mangaTranslateOnnx(task, ctx),
  "manga.clean.preview": (task, ctx) => mangaCleanPreview(task, ctx),
});
