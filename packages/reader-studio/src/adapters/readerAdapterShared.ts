import {
  type ReaderBook,
  type ReaderFormat,
  type ReaderOpenInput,
  type ReaderSection,
  type ReaderTocItem,
} from "@bcr/reader-core";
import { displayFormat } from "./formats";

function titleFromName(name: string): string {
  const basename = name.split(/[\\/]/u).pop() ?? name;
  return basename.replace(/\.[^.]+$/u, "") || "未命名读物";
}

export function baseSource(input: ReaderOpenInput, objectUrl?: string) {
  return {
    name: input.file.name,
    format: input.format,
    mime: input.file.type || mimeForFormat(input.format),
    size: input.file.size,
    ...(objectUrl === undefined ? {} : { objectUrl }),
  } as const;
}

function mimeForFormat(format: ReaderFormat): string {
  switch (format) {
    case "pdf":
      return "application/pdf";
    case "epub":
    case "cbz":
      return "application/zip";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "html":
      return "text/html";
    case "markdown":
      return "text/markdown";
    default:
      return "text/plain";
  }
}

export function makeBook(
  input: ReaderOpenInput,
  sections: ReadonlyArray<ReaderSection>,
  metadata: {
    title?: string;
    author?: string;
    language?: string;
    coverUrl?: string;
    toc?: ReadonlyArray<ReaderTocItem>;
  } = {},
): ReaderBook {
  const now = Date.now();
  return {
    id: input.id,
    title: metadata.title?.trim() || titleFromName(input.file.name),
    ...(metadata.author === undefined ? {} : { author: metadata.author }),
    ...(metadata.language === undefined ? {} : { language: metadata.language }),
    ...(metadata.coverUrl === undefined ? {} : { coverUrl: metadata.coverUrl }),
    source: baseSource(input),
    sections,
    ...(metadata.toc === undefined ? {} : { toc: metadata.toc }),
    importedAt: now,
    updatedAt: now,
    tags: [displayFormat(input.format)],
  };
}
