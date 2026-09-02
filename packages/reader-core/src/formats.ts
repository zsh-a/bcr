import type { ReaderFormat } from "./model";

export type ReaderFormatSupport = "native" | "unsupported";

export interface ReaderFormatDescriptor {
  readonly format: ReaderFormat;
  readonly label: string;
  readonly extensions: ReadonlyArray<string>;
  readonly mimeTypes: ReadonlyArray<string>;
  readonly support: ReaderFormatSupport;
  readonly description: string;
}

/**
 * One source of truth for the import surface. Parser implementations live in
 * the app adapter, while labels and accepted extensions stay format-agnostic.
 */
export const READER_FORMAT_CATALOG: ReadonlyArray<ReaderFormatDescriptor> = [
  {
    format: "txt",
    label: "TXT",
    extensions: [".txt"],
    mimeTypes: ["text/plain"],
    support: "native",
    description: "纯文本与长文稿",
  },
  {
    format: "markdown",
    label: "MARKDOWN",
    extensions: [".md", ".markdown", ".mdown"],
    mimeTypes: ["text/markdown", "text/x-markdown"],
    support: "native",
    description: "带轻量排版的文本",
  },
  {
    format: "html",
    label: "HTML",
    extensions: [".html", ".htm"],
    mimeTypes: ["text/html"],
    support: "native",
    description: "经过安全清理的网页文档",
  },
  {
    format: "docx",
    label: "DOCX",
    extensions: [".docx"],
    mimeTypes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    support: "native",
    description: "Word 文本、标题与表格",
  },
  {
    format: "fb2",
    label: "FB2",
    extensions: [".fb2"],
    mimeTypes: ["application/x-fictionbook+xml", "text/xml", "application/xml"],
    support: "native",
    description: "开放 FictionBook 出版物",
  },
  {
    format: "epub",
    label: "EPUB",
    extensions: [".epub"],
    mimeTypes: ["application/epub+zip", "application/zip"],
    support: "native",
    description: "可重排章节与内嵌图片",
  },
  {
    format: "pdf",
    label: "PDF",
    extensions: [".pdf"],
    mimeTypes: ["application/pdf"],
    support: "native",
    description: "保留原始版式的分页阅读",
  },
  {
    format: "cbz",
    label: "CBZ",
    extensions: [".cbz", ".zip"],
    mimeTypes: ["application/vnd.comicbook+zip", "application/zip"],
    support: "native",
    description: "按自然排序的漫画图片页",
  },
  {
    format: "cbr",
    label: "CBR",
    extensions: [".cbr"],
    mimeTypes: ["application/vnd.comicbook-rar", "application/x-rar-compressed"],
    support: "unsupported",
    description: "RAR 漫画归档（等待浏览器安全解码器）",
  },
  {
    format: "mobi",
    label: "MOBI",
    extensions: [".mobi"],
    mimeTypes: ["application/x-mobipocket-ebook"],
    support: "unsupported",
    description: "移动端电子书格式（等待解析器）",
  },
  {
    format: "azw3",
    label: "AZW3",
    extensions: [".azw", ".azw3"],
    mimeTypes: ["application/vnd.amazon.ebook"],
    support: "unsupported",
    description: "Kindle 电子书格式（等待解析器）",
  },
];

export function readerFormatDescriptor(format: ReaderFormat): ReaderFormatDescriptor | undefined {
  return READER_FORMAT_CATALOG.find((candidate) => candidate.format === format);
}

export function readerAcceptAttribute(): string {
  return READER_FORMAT_CATALOG.filter((candidate) => candidate.support === "native")
    .flatMap((candidate) => [...candidate.extensions, ...candidate.mimeTypes])
    .join(",");
}
