import type { ArtifactRef } from "@bcr/core";

export type DocumentFormat =
  | "txt"
  | "markdown"
  | "html"
  | "fb2"
  | "epub"
  | "pdf"
  | "cbz"
  | "image"
  | "unknown";

export type DocumentStageId =
  | "ingest"
  | "normalize"
  | "extract"
  | "ocr"
  | "translate"
  | "typeset"
  | "export";

export type DocumentStageStatus = "idle" | "running" | "done" | "blocked" | "error";

export type DocumentCapability = "ready" | "adapter" | "planned";

export interface DocumentStageState {
  readonly id: DocumentStageId;
  readonly label: string;
  readonly detail: string;
  readonly capability: DocumentCapability;
  readonly status: DocumentStageStatus;
  readonly progress: number;
  readonly artifact?: ArtifactRef | undefined;
  readonly error?: string | undefined;
}

export interface DocumentJob {
  readonly id: string;
  readonly name: string;
  readonly format: DocumentFormat;
  readonly size: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly sourceUrl?: string | undefined;
  readonly sourceTextPreview?: string | undefined;
  readonly sourceRef?: ArtifactRef | undefined;
  readonly stages: ReadonlyArray<DocumentStageState>;
}

export interface DocumentExtractedSection {
  readonly id: string;
  readonly order: number;
  readonly label: string;
  readonly text: string;
}

export interface DocumentExtractArtifact {
  readonly version: 1;
  readonly format: DocumentFormat;
  readonly sourceName: string;
  readonly sections: ReadonlyArray<DocumentExtractedSection>;
}

export interface DocumentStageDefinition {
  readonly id: DocumentStageId;
  readonly label: string;
  readonly detail: string;
  readonly capability: DocumentCapability;
}

export const DOCUMENT_STAGES: ReadonlyArray<DocumentStageDefinition> = [
  {
    id: "ingest",
    label: "Ingest",
    detail: "接收源文件并登记内容地址",
    capability: "ready",
  },
  {
    id: "normalize",
    label: "Normalize",
    detail: "统一编码、方向与出版物元数据",
    capability: "ready",
  },
  {
    id: "extract",
    label: "Extract",
    detail: "提取章节、文本层或页面清单",
    capability: "adapter",
  },
  {
    id: "ocr",
    label: "OCR",
    detail: "识别图片中的文字区域与阅读顺序",
    capability: "planned",
  },
  {
    id: "translate",
    label: "Translate",
    detail: "保留段落与区域 ID 的术语感知翻译",
    capability: "planned",
  },
  {
    id: "typeset",
    label: "Typeset",
    detail: "应用目标语言排版与溢出检查",
    capability: "planned",
  },
  {
    id: "export",
    label: "Export",
    detail: "导出 Reader / Manga 可消费的出版物",
    capability: "adapter",
  },
];

export function formatForName(name: string, mime = ""): DocumentFormat {
  const extension = name.split(".").pop()?.toLocaleLowerCase() ?? "";
  if (extension === "md" || extension === "markdown") return "markdown";
  if (extension === "txt" || mime === "text/plain") return "txt";
  if (extension === "html" || extension === "htm" || mime === "text/html") return "html";
  if (extension === "fb2" || mime === "application/x-fictionbook+xml") return "fb2";
  if (extension === "epub" || mime === "application/epub+zip") return "epub";
  if (extension === "pdf" || mime === "application/pdf") return "pdf";
  if (extension === "cbz" || mime === "application/vnd.comicbook+zip") return "cbz";
  if (mime.startsWith("image/") || ["png", "jpg", "jpeg", "webp", "avif"].includes(extension)) {
    return "image";
  }
  return "unknown";
}

export function formatLabel(format: DocumentFormat): string {
  return format === "markdown" ? "MARKDOWN" : format.toUpperCase();
}

export function createStageStates(): ReadonlyArray<DocumentStageState> {
  return DOCUMENT_STAGES.map((stage) => ({
    ...stage,
    status: "idle" as const,
    progress: 0,
  }));
}

export function createDocumentJob(input: {
  readonly id: string;
  readonly name: string;
  readonly format: DocumentFormat;
  readonly size: number;
  readonly sourceUrl?: string | undefined;
  readonly sourceTextPreview?: string | undefined;
  readonly sourceRef?: ArtifactRef | undefined;
  readonly now?: number | undefined;
}): DocumentJob {
  const now = input.now ?? Date.now();
  return {
    id: input.id,
    name: input.name,
    format: input.format,
    size: input.size,
    createdAt: now,
    updatedAt: now,
    ...(input.sourceUrl === undefined ? {} : { sourceUrl: input.sourceUrl }),
    ...(input.sourceTextPreview === undefined
      ? {}
      : { sourceTextPreview: input.sourceTextPreview }),
    ...(input.sourceRef === undefined ? {} : { sourceRef: input.sourceRef }),
    stages: createStageStates(),
  };
}
