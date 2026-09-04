import { artifactPath, type ArtifactRef } from "@bcr/core";
import { createDocumentOcrContent } from "@bcr/document-core";
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
import { configureMangaTransformersCache } from "@bcr/manga-studio/model-cache";
import type { WorkerContext } from "@bcr/runtime-worker";
import {
  configBoolean,
  configNumber,
  configText,
  opfs,
  readJsonArtifact,
  throwIfAborted,
  writeTypedJsonArtifact,
} from "./computeShared";

function offlineOnly(task: { config?: Record<string, unknown> | undefined }): boolean {
  const online = typeof navigator === "undefined" ? true : navigator.onLine;
  return configBoolean(task.config?.["offlineOnly"], false) || online === false;
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
export async function mangaOcrReview(
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

const ocrTranscriberCache = new Map<string, LoadedModel<OcrTranscriber>>();
const ocrTranscriberLoading = new Map<string, Promise<LoadedModel<OcrTranscriber>>>();

async function buildOcrTranscriber(
  model: string,
  device: ResolvedOcrDevice,
  localOnly: boolean,
  ctx: WorkerContext,
): Promise<OcrTranscriber> {
  const { pipeline, env } = await import("@huggingface/transformers");
  env.allowLocalModels = localOnly;
  env.allowRemoteModels = !localOnly;
  await configureMangaTransformersCache(env);
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
  localOnly: boolean,
  ctx: WorkerContext,
): Promise<LoadedModel<OcrTranscriber>> {
  const requested = resolveOcrDevice(device);
  const key = `${model}::${device}::${requested.device}::${localOnly ? "offline" : "online"}`;
  const cached = ocrTranscriberCache.get(key);
  if (cached !== undefined) return cached;
  const inFlight = ocrTranscriberLoading.get(key);
  if (inFlight !== undefined) return inFlight;
  const loading = (async (): Promise<LoadedModel<OcrTranscriber>> => {
    try {
      const fn = await buildOcrTranscriber(model, requested.device, localOnly, ctx);
      return {
        fn,
        device: requested.device,
        ...(requested.fallbackReason === undefined
          ? {}
          : { fallbackReason: requested.fallbackReason }),
      };
    } catch (error) {
      if (requested.device !== "webgpu") throw error;
      console.warn("[manga-ocr] WebGPU initialization failed, falling back to WASM:", error);
      const fn = await buildOcrTranscriber(model, "wasm", localOnly, ctx);
      return { fn, device: "wasm", fallbackReason: "webgpu-init-failed" };
    }
  })();
  ocrTranscriberLoading.set(key, loading);
  try {
    const loaded = await loading;
    ocrTranscriberCache.set(key, loaded);
    return loaded;
  } finally {
    if (ocrTranscriberLoading.get(key) === loading) ocrTranscriberLoading.delete(key);
  }
}

/** Explicit model preflight: warm Transformers.js cache without touching a page. */
export async function mangaModelPreload(
  task: { inputs: ReadonlyArray<ArtifactRef>; config?: Record<string, unknown> | undefined },
  ctx: WorkerContext,
): Promise<ReadonlyArray<ArtifactRef>> {
  const kind = configText(task.config?.["kind"], "");
  const model = configText(task.config?.["model"], "").trim();
  if (model.length === 0) throw new Error("manga.model.preload requires a model");
  const deviceValue = configText(task.config?.["device"], "auto");
  const device: OcrDevice =
    deviceValue === "webgpu" || deviceValue === "wasm" ? deviceValue : "auto";
  const localOnly = offlineOnly(task);
  const languageValue = configText(task.config?.["sourceLanguage"], "ja");
  const sourceLanguage: MangaSourceLanguage =
    languageValue === "en" || languageValue === "ko" ? languageValue : "ja";
  ctx.progress(0.01);

  if (kind === "ocr") {
    const adapterValue = configText(task.config?.["adapter"], "manga.onnx");
    const adapter: MangaOcrAdapterId =
      adapterValue === "vision.onnx" || adapterValue === "manga.onnx"
        ? adapterValue
        : "review.manual";
    const resolution = resolveMangaOcrAdapter(adapter, sourceLanguage, { model, device });
    if (
      resolution.execution.effectiveAdapter === "review.manual" ||
      resolution.execution.model === undefined
    ) {
      throw new Error(`manga.model.preload cannot load OCR model for ${sourceLanguage}`);
    }
    await loadOcrTranscriber(model, device, localOnly, ctx);
    throwIfAborted(ctx);
    ctx.progress(1);
    return [];
  }

  if (kind === "translation") {
    const resolution = resolveMangaTranslationAdapter("local", sourceLanguage, {
      model,
      device,
    });
    if (resolution.execution.effectiveAdapter !== "local") {
      throw new Error(`manga.model.preload cannot load translation model for ${sourceLanguage}`);
    }
    await loadMangaTranslator(model, device, localOnly, ctx);
    throwIfAborted(ctx);
    ctx.progress(1);
    return [];
  }

  throw new Error(`manga.model.preload received unknown kind: ${kind || "empty"}`);
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
export async function mangaOcrOnnx(
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
  const localOnly = offlineOnly(task);
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
  const modelLoadStartedAt = performance.now();
  const loaded = await loadOcrTranscriber(model, device, localOnly, ctx);
  const modelLoadDurationMs = performance.now() - modelLoadStartedAt;
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
    modelUsed: true,
    modelLoadDurationMs,
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

function documentOcrRegions(task: {
  config?: Record<string, unknown> | undefined;
}): ReadonlyArray<Record<string, unknown>> {
  const raw = task.config?.["regions"];
  if (Array.isArray(raw) && raw.length > 0) {
    return raw.filter(
      (candidate): candidate is Record<string, unknown> =>
        typeof candidate === "object" && candidate !== null,
    );
  }
  // Document has no layout detector yet. A full-page region is an honest,
  // useful baseline for scanned single-page documents; Manga handles dense
  // multi-region layouts and can hand the richer result back later.
  return [
    {
      id: "page-1",
      label: "Page 1",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      writingMode: "horizontal-tb",
      sourceText: "",
      confidence: 0,
    },
  ];
}

/**
 * Document's visual adapter reuses the shared OCR model/cache path, then
 * projects the stable lines into the canonical Content Package contract.
 */
export async function documentOcrOnnx(
  task: { inputs: ReadonlyArray<ArtifactRef>; config?: Record<string, unknown> | undefined },
  ctx: WorkerContext,
): Promise<ReadonlyArray<ArtifactRef>> {
  const input = task.inputs.find((ref) => ref.port === "source") ?? task.inputs[0];
  if (input === undefined) throw new Error("document.ocr.onnx requires an image source artifact");
  const ocrOutputs = await mangaOcrOnnx(
    {
      ...task,
      config: {
        ...task.config,
        regions: documentOcrRegions(task),
      },
    },
    ctx,
  );
  const ocrRef = ocrOutputs[0];
  if (ocrRef === undefined) throw new Error("document.ocr.onnx returned no OCR artifact");
  const ocr = decodeMangaOcrArtifact(await readJsonArtifact<unknown>(ocrRef, ctx));
  const sourceLanguage = configText(task.config?.["sourceLanguage"], "en");
  const content = createDocumentOcrContent({
    id: `document-content/${input.hash ?? input.id}/ocr`,
    sourceName: configText(task.config?.["sourceName"], input.id),
    sourceRef: input,
    sourceHash: input.hash,
    sourceLanguage,
    adapter: "document.ocr.onnx",
    lines: ocr.lines,
  });
  const out = await writeTypedJsonArtifact(
    "document",
    "ocr-onnx",
    "document/content-package",
    content,
  );
  ctx.progress(1);
  return [out];
}

type MangaTranslator = (
  text: string | ReadonlyArray<string>,
  options?: Record<string, unknown>,
) => Promise<unknown>;

const mangaTranslatorCache = new Map<string, LoadedModel<MangaTranslator>>();
const mangaTranslatorLoading = new Map<string, Promise<LoadedModel<MangaTranslator>>>();

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
  localOnly: boolean,
  ctx: WorkerContext,
): Promise<MangaTranslator> {
  const { pipeline, env } = await import("@huggingface/transformers");
  env.allowLocalModels = localOnly;
  env.allowRemoteModels = !localOnly;
  await configureMangaTransformersCache(env);
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
  localOnly: boolean,
  ctx: WorkerContext,
): Promise<LoadedModel<MangaTranslator>> {
  const requested = resolveOcrDevice(device);
  const key = `${model}::${device}::${requested.device}::${localOnly ? "offline" : "online"}`;
  const cached = mangaTranslatorCache.get(key);
  if (cached !== undefined) return cached;
  const inFlight = mangaTranslatorLoading.get(key);
  if (inFlight !== undefined) return inFlight;
  const loading = (async (): Promise<LoadedModel<MangaTranslator>> => {
    try {
      const fn = await buildMangaTranslator(model, requested.device, localOnly, ctx);
      return {
        fn,
        device: requested.device,
        ...(requested.fallbackReason === undefined
          ? {}
          : { fallbackReason: requested.fallbackReason }),
      };
    } catch (error) {
      if (requested.device !== "webgpu") throw error;
      console.warn("[manga-translate] WebGPU initialization failed, falling back to WASM:", error);
      const fn = await buildMangaTranslator(model, "wasm", localOnly, ctx);
      return { fn, device: "wasm", fallbackReason: "webgpu-init-failed" };
    }
  })();
  mangaTranslatorLoading.set(key, loading);
  try {
    const loaded = await loading;
    mangaTranslatorCache.set(key, loaded);
    return loaded;
  } finally {
    if (mangaTranslatorLoading.get(key) === loading) mangaTranslatorLoading.delete(key);
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
export async function mangaTranslateOnnx(
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
  const localOnly = offlineOnly(task);
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
  const BATCH_SIZE = 8;
  const glossaryExactHits = translatable.length - pending.length;
  let completedCount = glossaryExactHits;
  let loaded: LoadedModel<MangaTranslator> | undefined;
  let modelLoadDurationMs: number | undefined;
  if (pending.length > 0) {
    const modelLoadStartedAt = performance.now();
    loaded = await loadMangaTranslator(model, device, localOnly, ctx);
    modelLoadDurationMs = performance.now() - modelLoadStartedAt;
    const translator = loaded.fn;
    for (let offset = 0; offset < pending.length; offset += BATCH_SIZE) {
      throwIfAborted(ctx);
      const batch = pending.slice(offset, offset + BATCH_SIZE);
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
      completedCount += batch.length;
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
      modelUsed: loaded !== undefined,
      ...(modelLoadDurationMs === undefined ? {} : { modelLoadDurationMs }),
      ...(loaded?.fallbackReason !== undefined
        ? { fallbackReason: loaded.fallbackReason }
        : requestedDeviceResolution.fallbackReason === undefined
          ? {}
          : { fallbackReason: requestedDeviceResolution.fallbackReason }),
      telemetry: {
        unit: "line",
        total: translatable.length,
        completed: completedCount,
        glossaryExactHits,
        batchSize: BATCH_SIZE,
      },
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
export async function mangaCleanPreview(
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
