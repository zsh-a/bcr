import type { ArtifactRef } from "@bcr/core";
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
export type MangaOcrAdapterId = "review.manual" | "vision.onnx";
export type MangaOcrDevice = "auto" | "webgpu" | "wasm";

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
];

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
  readonly artifact?: ArtifactRef | undefined;
  readonly error?: string | undefined;
}

export type OutputMode = "original" | "clean" | "translated";

export interface MangaSettings {
  readonly sourceLanguage: "ja" | "en" | "ko";
  readonly targetLanguage: "zh";
  readonly engine: "fixture" | "local";
  readonly ocrAdapter: MangaOcrAdapterId;
  readonly ocrModel: string;
  readonly ocrDevice: MangaOcrDevice;
  readonly cleanMode: "fill" | "inpaint";
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
  readonly stages: ReadonlyArray<StageState>;
  readonly regions: ReadonlyArray<TextRegion>;
  readonly activeRegionId: string | null;
  readonly outputMode: OutputMode;
  readonly outputReady: boolean;
  readonly dirty: boolean;
}
