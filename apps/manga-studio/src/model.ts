import type { ArtifactRef, RuntimeKind } from "@bcr/core";
import type { Graph } from "@bcr/graph";

export type MangaSourceKind = "fixture" | "image";

export interface MangaSource {
  readonly id: string;
  readonly kind: MangaSourceKind;
  readonly name: string;
  readonly size: number;
  readonly objectUrl: string;
  /** Imported images are backed by an immutable OPFS artifact; fixture pages omit it. */
  readonly ref?: ArtifactRef | undefined;
  readonly width: number;
  readonly height: number;
  readonly pageCount: number;
}

export type WritingMode = "horizontal-tb" | "vertical-rl";
export type RegionStatus = "detected" | "needs-review" | "reviewed";
export type MangaOcrAdapterId = "review.manual" | "vision.onnx" | "manga.onnx";
export type MangaOcrDevice = "auto" | "webgpu" | "wasm";
export type MangaSourceLanguage = "ja" | "en" | "ko";
export type MangaTranslationEngineId = "fixture" | "local";
export type MangaCleanMode = "fill" | "inpaint";
export type MangaCleanAdapterId = "fill" | "inpaint.onnx";

/** Runtime device chosen for an adapter execution (review/fixture are logical devices). */
export type MangaResolvedDevice = "review" | "fixture" | "webgpu" | "wasm";

/** Reasons that are safe to surface when a requested adapter is resolved differently. */
export type MangaAdapterFallbackReason =
  | "language-unsupported"
  | "webgpu-unavailable"
  | "webgpu-init-failed"
  | "adapter-not-ready"
  | "model-missing"
  | "missing-input";

export type MangaAdapterPhase = "queued" | "loading-model" | "running" | "completed";
export type MangaAdapterCacheStatus = "hit" | "miss" | "disabled";

/** Persisted execution facts shared by OCR/translation artifacts and stage UI. */
export interface MangaAdapterExecution {
  readonly kind: "ocr" | "translation";
  readonly requestedAdapter: MangaOcrAdapterId | MangaTranslationEngineId;
  readonly effectiveAdapter: MangaOcrAdapterId | MangaTranslationEngineId;
  readonly runtime: "review" | "fixture" | RuntimeKind;
  readonly requestedDevice: MangaOcrDevice;
  readonly effectiveDevice: MangaResolvedDevice;
  readonly phase?: MangaAdapterPhase | undefined;
  readonly cache?: MangaAdapterCacheStatus | undefined;
  readonly model?: string | undefined;
  readonly sourceLanguage?: MangaSourceLanguage | undefined;
  readonly targetLanguage?: "zh" | undefined;
  readonly fallbackReason?: MangaAdapterFallbackReason | undefined;
}

/**
 * 文本区域使用相对坐标，避免页面缩放后丢失编辑位置。
 * 这也是 OCR、翻译、排版之间稳定传递的最小领域对象。
 */
export interface TextRegion {
  readonly id: string;
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  readonly writingMode: WritingMode;
  readonly sourceText: string;
  readonly translatedText: string;
  readonly confidence: number;
  readonly status: RegionStatus;
}

/**
 * Stable OCR boundary. Coordinates stay normalized so a later detector or
 * renderer can change pixel density without invalidating review edits.
 */
export interface MangaOcrLine {
  readonly id: string;
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  readonly writingMode: WritingMode;
  readonly text: string;
  readonly confidence: number;
  readonly status: RegionStatus;
}

/** Versioned output written by an OCR adapter and consumed by review/order. */
export interface MangaOcrArtifact {
  readonly version: 1;
  readonly adapter: MangaOcrAdapterId;
  readonly sourceName: string;
  readonly coordinateSpace: "normalized-percent";
  readonly lines: ReadonlyArray<MangaOcrLine>;
  /** Actual adapter/device chosen by the Worker, including any fallback. */
  readonly execution?: MangaAdapterExecution | undefined;
}

/** Project-level terminology that survives page changes and refreshes. */
export interface MangaGlossaryEntry {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly note: string;
  readonly enabled: boolean;
}

/** Lazy model manifest. The first model is deterministic; the second is opt-in. */
export interface MangaOcrModelManifest {
  readonly id: MangaOcrAdapterId;
  readonly label: string;
  readonly model?: string | undefined;
  readonly runtime: "review" | "wasm";
  readonly languages: ReadonlyArray<"ja" | "en" | "ko">;
  readonly status: "ready" | "experimental";
  readonly detail: string;
}

export const OCR_MODEL_MANIFESTS: ReadonlyArray<MangaOcrModelManifest> = [
  {
    id: "review.manual",
    label: "Review / 手工区域",
    runtime: "review",
    languages: ["ja", "en", "ko"],
    status: "ready",
    detail: "固化人工区域，不读取像素",
  },
  {
    id: "vision.onnx",
    label: "Local ONNX / 实验",
    model: "Xenova/trocr-small-printed",
    runtime: "wasm",
    languages: ["en"],
    status: "experimental",
    detail: "浏览器内按区域识别；模型主要面向 Latin 印刷体",
  },
  {
    id: "manga.onnx",
    label: "Manga OCR / 日本語",
    model: "onnx-community/manga-ocr-base-ONNX",
    runtime: "wasm",
    languages: ["ja"],
    status: "experimental",
    detail: "面向日文漫画的横/竖排识别；支持振假名与复杂字体，结果仍需人工审校",
  },
];

export interface MangaTranslationModelManifest {
  readonly id: MangaTranslationEngineId;
  readonly label: string;
  readonly models: Readonly<Partial<Record<MangaSourceLanguage, string>>>;
  readonly runtime: "fixture" | "wasm";
  readonly status: "ready" | "experimental";
  readonly detail: string;
}

/** Translation catalog is deliberately explicit so a language never silently picks a wrong model. */
export const TRANSLATION_MODEL_MANIFESTS: ReadonlyArray<MangaTranslationModelManifest> = [
  {
    id: "fixture",
    label: "Fixture / 离线演示",
    models: {},
    runtime: "fixture",
    status: "ready",
    detail: "确定性离线映射，适合审校 UI 与队列回归",
  },
  {
    id: "local",
    label: "Local ONNX / 实验",
    models: {
      ja: "Xenova/nllb-200-distilled-600M",
      en: "Xenova/nllb-200-distilled-600M",
      ko: "Xenova/nllb-200-distilled-600M",
    },
    runtime: "wasm",
    status: "experimental",
    detail: "浏览器内懒加载多语 NLLB；模型较大，译文仍需人工审校",
  },
];

export interface MangaAdapterResolutionOptions {
  readonly model?: string | undefined;
  readonly device?: MangaOcrDevice | undefined;
  /** Tests and non-browser hosts can inject the capability result. */
  readonly webgpuAvailable?: boolean | undefined;
}

export interface MangaOcrAdapterResolution {
  readonly manifest: MangaOcrModelManifest;
  readonly effectiveManifest: MangaOcrModelManifest;
  readonly execution: MangaAdapterExecution;
}

export interface MangaTranslationAdapterResolution {
  readonly manifest: MangaTranslationModelManifest;
  readonly effectiveManifest: MangaTranslationModelManifest;
  readonly execution: MangaAdapterExecution;
}

/** Browser capability probe kept in one place so UI and Worker use the same rule. */
export function mangaWebGpuAvailable(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

/** Resolve a local model device. A missing WebGPU capability is always explicit. */
export function resolveMangaDevice(
  requestedDevice: MangaOcrDevice,
  webgpuAvailable = mangaWebGpuAvailable(),
): {
  readonly requestedDevice: MangaOcrDevice;
  readonly effectiveDevice: Extract<MangaResolvedDevice, "webgpu" | "wasm">;
  readonly fallbackReason?: "webgpu-unavailable";
} {
  if (requestedDevice === "wasm") {
    return { requestedDevice, effectiveDevice: "wasm" };
  }
  if (webgpuAvailable) {
    return { requestedDevice, effectiveDevice: "webgpu" };
  }
  return {
    requestedDevice,
    effectiveDevice: "wasm",
    fallbackReason: "webgpu-unavailable",
  };
}

function requestedDevice(options: MangaAdapterResolutionOptions | undefined): MangaOcrDevice {
  const value = options?.device;
  return value === "webgpu" || value === "wasm" ? value : "auto";
}

function withOptionalModel(
  execution: MangaAdapterExecution,
  model: string | undefined,
): MangaAdapterExecution {
  return model === undefined || model.trim().length === 0 ? execution : { ...execution, model };
}

/** Resolve OCR language, adapter readiness and device before a task is submitted. */
export function resolveMangaOcrAdapter(
  adapter: MangaOcrAdapterId,
  sourceLanguage: MangaSourceLanguage,
  options?: MangaAdapterResolutionOptions,
): MangaOcrAdapterResolution {
  const manifest = OCR_MODEL_MANIFESTS.find((candidate) => candidate.id === adapter);
  if (manifest === undefined) {
    throw new Error(`unknown manga OCR adapter: ${adapter}`);
  }
  const device = requestedDevice(options);
  const model = options?.model ?? manifest.model;
  if (adapter !== "review.manual" && !manifest.languages.includes(sourceLanguage)) {
    const execution = withOptionalModel(
      {
        kind: "ocr",
        requestedAdapter: adapter,
        effectiveAdapter: "review.manual",
        runtime: "review",
        requestedDevice: device,
        effectiveDevice: "review",
        sourceLanguage,
        fallbackReason: "language-unsupported",
      },
      model,
    );
    const effectiveManifest = OCR_MODEL_MANIFESTS.find(
      (candidate) => candidate.id === "review.manual",
    );
    if (effectiveManifest === undefined) throw new Error("review OCR adapter manifest is missing");
    return { manifest, effectiveManifest, execution };
  }
  if (adapter === "review.manual") {
    return {
      manifest,
      effectiveManifest: manifest,
      execution: {
        kind: "ocr",
        requestedAdapter: adapter,
        effectiveAdapter: adapter,
        runtime: "review",
        requestedDevice: device,
        effectiveDevice: "review",
        sourceLanguage,
      },
    };
  }
  const resolvedDevice = resolveMangaDevice(device, options?.webgpuAvailable);
  return {
    manifest,
    effectiveManifest: manifest,
    execution: withOptionalModel(
      {
        kind: "ocr",
        requestedAdapter: adapter,
        effectiveAdapter: adapter,
        runtime: manifest.runtime,
        requestedDevice: resolvedDevice.requestedDevice,
        effectiveDevice: resolvedDevice.effectiveDevice,
        sourceLanguage,
        ...(resolvedDevice.fallbackReason === undefined
          ? {}
          : { fallbackReason: resolvedDevice.fallbackReason }),
      },
      model,
    ),
  };
}

/** Resolve translation engine/model and make missing-model fallback observable. */
export function resolveMangaTranslationAdapter(
  adapter: MangaTranslationEngineId,
  sourceLanguage: MangaSourceLanguage,
  options?: MangaAdapterResolutionOptions,
): MangaTranslationAdapterResolution {
  const manifest = TRANSLATION_MODEL_MANIFESTS.find((candidate) => candidate.id === adapter);
  if (manifest === undefined) {
    throw new Error(`unknown manga translation adapter: ${adapter}`);
  }
  const device = requestedDevice(options);
  const model = options?.model ?? manifest.models[sourceLanguage];
  if (adapter === "fixture" || model === undefined || model.trim().length === 0) {
    const fallbackReason =
      adapter === "fixture" ? undefined : ("model-missing" satisfies MangaAdapterFallbackReason);
    const effectiveManifest = TRANSLATION_MODEL_MANIFESTS.find(
      (candidate) => candidate.id === "fixture",
    );
    if (effectiveManifest === undefined) throw new Error("fixture translation manifest is missing");
    return {
      manifest,
      effectiveManifest,
      execution: withOptionalModel(
        {
          kind: "translation",
          requestedAdapter: adapter,
          effectiveAdapter: "fixture",
          runtime: "fixture",
          requestedDevice: device,
          effectiveDevice: "fixture",
          sourceLanguage,
          targetLanguage: "zh",
          ...(fallbackReason === undefined ? {} : { fallbackReason }),
        },
        model,
      ),
    };
  }
  const resolvedDevice = resolveMangaDevice(device, options?.webgpuAvailable);
  return {
    manifest,
    effectiveManifest: manifest,
    execution: withOptionalModel(
      {
        kind: "translation",
        requestedAdapter: adapter,
        effectiveAdapter: adapter,
        runtime: manifest.runtime,
        requestedDevice: resolvedDevice.requestedDevice,
        effectiveDevice: resolvedDevice.effectiveDevice,
        sourceLanguage,
        targetLanguage: "zh",
        ...(resolvedDevice.fallbackReason === undefined
          ? {}
          : { fallbackReason: resolvedDevice.fallbackReason }),
      },
      model,
    ),
  };
}

export interface MangaCleanModelManifest {
  readonly id: MangaCleanAdapterId;
  readonly label: string;
  readonly runtime: "fixture" | "wasm";
  readonly status: "ready" | "experimental";
  readonly detail: string;
}

/** Cleaning stays explicit: generated inpainting is not silently replaced by a fill. */
export const CLEAN_MODEL_MANIFESTS: ReadonlyArray<MangaCleanModelManifest> = [
  {
    id: "fill",
    label: "Fill / 稳定",
    runtime: "fixture",
    status: "ready",
    detail: "基于区域掩码的可追溯填充，适合预览与导出",
  },
  {
    id: "inpaint.onnx",
    label: "Inpaint / 实验",
    runtime: "wasm",
    status: "experimental",
    detail: "生成式修复尚未接入；当前请求会显式回退 Fill",
  },
];

export interface MangaCleanRegionMask {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
}

export interface MangaCleanArtifact {
  readonly version: 1;
  readonly adapter: "fill";
  readonly sourceName: string;
  readonly coordinateSpace: "normalized-percent";
  readonly requestedMode: MangaCleanMode;
  readonly effectiveMode: "fill";
  readonly fallbackReason?: "inpaint-adapter-not-ready";
  readonly regions: ReadonlyArray<MangaCleanRegionMask>;
}

export function resolveMangaCleanMode(mode: MangaCleanMode): {
  readonly requestedMode: MangaCleanMode;
  readonly effectiveMode: "fill";
  readonly adapter: "fill";
  readonly fallbackReason?: "inpaint-adapter-not-ready";
} {
  if (mode === "inpaint") {
    return {
      requestedMode: mode,
      effectiveMode: "fill",
      adapter: "fill",
      fallbackReason: "inpaint-adapter-not-ready",
    };
  }
  return { requestedMode: mode, effectiveMode: "fill", adapter: "fill" };
}

export interface MangaTranslationLine {
  readonly id: string;
  readonly sourceText: string;
  readonly translatedText: string;
  readonly status: "needs-review";
}

export interface MangaTranslationArtifact {
  readonly version: 1;
  readonly adapter: "fixture.translate" | "local.onnx";
  readonly sourceName: string;
  readonly sourceLanguage: MangaSourceLanguage;
  readonly targetLanguage: "zh";
  readonly lines: ReadonlyArray<MangaTranslationLine>;
  /** Actual adapter/device chosen by the Worker, including any fallback. */
  readonly execution?: MangaAdapterExecution | undefined;
}

type UnknownRecord = Record<string, unknown>;

function recordValue(value: unknown): UnknownRecord | undefined {
  return typeof value === "object" && value !== null ? (value as UnknownRecord) : undefined;
}

function oneOf<T extends string>(value: unknown, values: ReadonlyArray<T>): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function decodeMangaAdapterExecution(
  value: unknown,
  kind: MangaAdapterExecution["kind"],
): MangaAdapterExecution | undefined {
  if (value === undefined) return undefined;
  const candidate = recordValue(value);
  if (candidate === undefined) throw new Error("manga adapter execution must be an object");
  if (candidate["kind"] !== kind) throw new Error("manga adapter execution kind mismatch");
  const ocrAdapters = ["review.manual", "vision.onnx", "manga.onnx"] as const;
  const translationAdapters = ["fixture", "local"] as const;
  const adapters = kind === "ocr" ? ocrAdapters : translationAdapters;
  if (!oneOf(candidate["requestedAdapter"], adapters)) {
    throw new Error("manga adapter execution requestedAdapter is invalid");
  }
  if (!oneOf(candidate["effectiveAdapter"], adapters)) {
    throw new Error("manga adapter execution effectiveAdapter is invalid");
  }
  if (!oneOf(candidate["runtime"], ["review", "fixture", "wasm", "webgpu", "webcodecs", "js"])) {
    throw new Error("manga adapter execution runtime is invalid");
  }
  if (!oneOf(candidate["requestedDevice"], ["auto", "webgpu", "wasm"])) {
    throw new Error("manga adapter execution requestedDevice is invalid");
  }
  if (!oneOf(candidate["effectiveDevice"], ["review", "fixture", "webgpu", "wasm"])) {
    throw new Error("manga adapter execution effectiveDevice is invalid");
  }
  if (
    candidate["phase"] !== undefined &&
    !oneOf(candidate["phase"], ["queued", "loading-model", "running", "completed"])
  ) {
    throw new Error("manga adapter execution phase is invalid");
  }
  if (candidate["cache"] !== undefined && !oneOf(candidate["cache"], ["hit", "miss", "disabled"])) {
    throw new Error("manga adapter execution cache is invalid");
  }
  if (
    candidate["fallbackReason"] !== undefined &&
    !oneOf(candidate["fallbackReason"], [
      "language-unsupported",
      "webgpu-unavailable",
      "webgpu-init-failed",
      "adapter-not-ready",
      "model-missing",
      "missing-input",
    ])
  ) {
    throw new Error("manga adapter execution fallbackReason is invalid");
  }
  if (candidate["model"] !== undefined && typeof candidate["model"] !== "string") {
    throw new Error("manga adapter execution model is invalid");
  }
  if (
    candidate["sourceLanguage"] !== undefined &&
    !oneOf(candidate["sourceLanguage"], ["ja", "en", "ko"])
  ) {
    throw new Error("manga adapter execution sourceLanguage is invalid");
  }
  if (candidate["targetLanguage"] !== undefined && candidate["targetLanguage"] !== "zh") {
    throw new Error("manga adapter execution targetLanguage is invalid");
  }
  return candidate as unknown as MangaAdapterExecution;
}

function decodeMangaOcrLine(value: unknown, index: number): MangaOcrLine {
  const candidate = recordValue(value);
  if (candidate === undefined) throw new Error(`manga OCR line ${index + 1} is invalid`);
  const requiredStrings = ["id", "label", "text"] as const;
  if (requiredStrings.some((key) => typeof candidate[key] !== "string")) {
    throw new Error(`manga OCR line ${index + 1} is invalid`);
  }
  const numeric = ["x", "y", "width", "height", "rotation", "confidence"] as const;
  if (numeric.some((key) => !finite(candidate[key]))) {
    throw new Error(`manga OCR line ${index + 1} has invalid geometry/confidence`);
  }
  const confidence = candidate["confidence"];
  if (!finite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error(`manga OCR line ${index + 1} confidence is outside 0..1`);
  }
  if (!oneOf(candidate["writingMode"], ["horizontal-tb", "vertical-rl"])) {
    throw new Error(`manga OCR line ${index + 1} writingMode is invalid`);
  }
  if (!oneOf(candidate["status"], ["detected", "needs-review", "reviewed"])) {
    throw new Error(`manga OCR line ${index + 1} status is invalid`);
  }
  return candidate as unknown as MangaOcrLine;
}

/** Decode v1 OCR artifacts, accepting older v1 payloads without execution facts. */
export function decodeMangaOcrArtifact(value: unknown): MangaOcrArtifact {
  const candidate = recordValue(value);
  if (
    candidate === undefined ||
    candidate["version"] !== 1 ||
    !oneOf(candidate["adapter"], ["review.manual", "vision.onnx", "manga.onnx"]) ||
    typeof candidate["sourceName"] !== "string" ||
    candidate["coordinateSpace"] !== "normalized-percent" ||
    !Array.isArray(candidate["lines"])
  ) {
    throw new Error("manga OCR Artifact contract validation failed");
  }
  const lines = candidate["lines"].map((line, index) => decodeMangaOcrLine(line, index));
  const execution = decodeMangaAdapterExecution(candidate["execution"], "ocr");
  return {
    version: 1,
    adapter: candidate["adapter"],
    sourceName: candidate["sourceName"],
    coordinateSpace: "normalized-percent",
    lines,
    ...(execution === undefined ? {} : { execution }),
  };
}

/** Decode v1 translation artifacts and reject adapter/line mismatches early. */
export function decodeMangaTranslationArtifact(value: unknown): MangaTranslationArtifact {
  const candidate = recordValue(value);
  if (
    candidate === undefined ||
    candidate["version"] !== 1 ||
    !oneOf(candidate["adapter"], ["fixture.translate", "local.onnx"]) ||
    typeof candidate["sourceName"] !== "string" ||
    !oneOf(candidate["sourceLanguage"], ["ja", "en", "ko"]) ||
    candidate["targetLanguage"] !== "zh" ||
    !Array.isArray(candidate["lines"])
  ) {
    throw new Error("manga translation Artifact contract validation failed");
  }
  const lines = candidate["lines"].map((line, index) => {
    const item = recordValue(line);
    if (
      item === undefined ||
      typeof item["id"] !== "string" ||
      typeof item["sourceText"] !== "string" ||
      typeof item["translatedText"] !== "string" ||
      item["status"] !== "needs-review"
    ) {
      throw new Error(`manga translation line ${index + 1} is invalid`);
    }
    return item as unknown as MangaTranslationLine;
  });
  const execution = decodeMangaAdapterExecution(candidate["execution"], "translation");
  return {
    version: 1,
    adapter: candidate["adapter"],
    sourceName: candidate["sourceName"],
    sourceLanguage: candidate["sourceLanguage"],
    targetLanguage: "zh",
    lines,
    ...(execution === undefined ? {} : { execution }),
  };
}

export type MangaStageId =
  | "import"
  | "normalize"
  | "detect"
  | "ocr"
  | "reading-order"
  | "translate"
  | "remove-text"
  | "typeset"
  | "export";

export type StageStatus = "idle" | "running" | "done" | "error";

export interface StageState {
  readonly id: MangaStageId;
  readonly label: string;
  readonly detail: string;
  readonly status: StageStatus;
  readonly progress: number;
  /** Durable execution facts used to explain model/device fallback. */
  readonly execution?: MangaAdapterExecution | undefined;
  readonly artifact?: ArtifactRef | undefined;
  readonly error?: string | undefined;
}

export type OutputMode = "original" | "clean" | "translated";

export interface MangaSettings {
  readonly sourceLanguage: MangaSourceLanguage;
  readonly targetLanguage: "zh";
  readonly engine: MangaTranslationEngineId;
  readonly ocrAdapter: MangaOcrAdapterId;
  readonly ocrModel: string;
  readonly ocrDevice: MangaOcrDevice;
  readonly translationDevice: MangaOcrDevice;
  readonly cleanMode: MangaCleanMode;
  readonly fontSize: number;
}

export interface MangaLogEntry {
  readonly ts: number;
  readonly level: "info" | "ok" | "warn" | "error";
  readonly message: string;
}

export type MangaBatchStatus = "running" | "paused" | "completed" | "error";

/** Durable queue job. Pages remain the unit of retry and Artifact lineage. */
export interface MangaBatchJob {
  readonly id: string;
  readonly pageIds: ReadonlyArray<string>;
  readonly completedPageIds: ReadonlyArray<string>;
  readonly activePageId: string | null;
  readonly status: MangaBatchStatus;
  readonly startedAt: number;
  readonly updatedAt: number;
  readonly error?: string | undefined;
}

export interface MangaState {
  readonly source: MangaSource;
  readonly pages: ReadonlyArray<MangaPage>;
  readonly activePageId: string;
  readonly graph: Graph;
  readonly stages: ReadonlyArray<StageState>;
  readonly regions: ReadonlyArray<TextRegion>;
  readonly activeRegionId: string | null;
  readonly outputMode: OutputMode;
  readonly settings: MangaSettings;
  readonly glossary: ReadonlyArray<MangaGlossaryEntry>;
  readonly running: boolean;
  readonly outputReady: boolean;
  readonly dirty: boolean;
  readonly logs: ReadonlyArray<MangaLogEntry>;
  readonly batch: MangaBatchJob | undefined;
}

/** A page is the unit of caching, review, retry and persistence. */
export interface MangaPage {
  readonly id: string;
  readonly source: MangaSource;
  /** Stable page creation time used for deterministic canonical projections. */
  readonly createdAt?: number | undefined;
  readonly stages: ReadonlyArray<StageState>;
  readonly regions: ReadonlyArray<TextRegion>;
  readonly activeRegionId: string | null;
  readonly outputMode: OutputMode;
  readonly outputReady: boolean;
  readonly dirty: boolean;
  /** Latest canonical Document package artifacts for cross-app handoff/search. */
  readonly documentContentRef?: ArtifactRef | undefined;
  readonly documentTranslationRef?: ArtifactRef | undefined;
}
