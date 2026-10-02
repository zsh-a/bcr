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

/**
 * Durable counters emitted by model-backed adapters.
 *
 * The stage progress bar is ephemeral. These counters travel with the
 * artifact so a restored or cached translation still explains how many lines
 * were processed and how glossary rules affected the run.
 */
export interface MangaAdapterTelemetry {
  readonly unit: "line";
  readonly total: number;
  readonly completed: number;
  readonly glossaryExactHits?: number | undefined;
  readonly batchSize?: number | undefined;
}

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
  /** True only when the Worker actually instantiated the model for this task. */
  readonly modelUsed?: boolean | undefined;
  /** Worker-side model construction latency, excluding queue and page work. */
  readonly modelLoadDurationMs?: number | undefined;
  readonly sourceLanguage?: MangaSourceLanguage | undefined;
  readonly targetLanguage?: "zh" | undefined;
  readonly fallbackReason?: MangaAdapterFallbackReason | undefined;
  readonly telemetry?: MangaAdapterTelemetry | undefined;
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

export interface MangaTranslationModelManifest {
  readonly id: MangaTranslationEngineId;
  readonly label: string;
  readonly models: Readonly<Partial<Record<MangaSourceLanguage, string>>>;
  readonly runtime: "fixture" | "wasm";
  readonly status: "ready" | "experimental";
  readonly detail: string;
}

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

export interface MangaCleanModelManifest {
  readonly id: MangaCleanAdapterId;
  readonly label: string;
  readonly runtime: "fixture" | "wasm";
  readonly status: "ready" | "experimental";
  readonly detail: string;
}

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
