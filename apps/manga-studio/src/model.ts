import type { Graph } from "@bcr/graph";

export type MangaSourceKind = "fixture" | "image";

export interface MangaSource {
  readonly id: string;
  readonly kind: MangaSourceKind;
  readonly name: string;
  readonly size: number;
  readonly objectUrl: string;
  readonly width: number;
  readonly height: number;
  readonly pageCount: number;
}

export type WritingMode = "horizontal-tb" | "vertical-rl";
export type RegionStatus = "detected" | "needs-review" | "reviewed";

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
  readonly error?: string;
}

export type OutputMode = "original" | "clean" | "translated";

export interface MangaSettings {
  readonly sourceLanguage: "ja" | "en" | "ko";
  readonly targetLanguage: "zh";
  readonly engine: "fixture" | "local";
  readonly cleanMode: "fill" | "inpaint";
  readonly fontSize: number;
}

export interface MangaLogEntry {
  readonly ts: number;
  readonly level: "info" | "ok" | "warn" | "error";
  readonly message: string;
}

export interface MangaState {
  readonly source: MangaSource;
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
}
