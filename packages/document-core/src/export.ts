import {
  decodeDocumentContentPackage,
  type DocumentContentPackage,
  type DocumentBlock,
} from "./content";
import { decodeDocumentTranslationPackage, type DocumentTranslationPackage } from "./translation";

/** Stable, human-readable export projections for every workbench. */
export type DocumentExportFormat = "json" | "markdown" | "text";
export type DocumentExportView = "source" | "translated" | "bilingual";

export interface DocumentExportBundle {
  readonly version: 1;
  readonly content: DocumentContentPackage;
  readonly translation?: DocumentTranslationPackage | undefined;
}

export interface DocumentExportPayload {
  readonly format: DocumentExportFormat;
  readonly view: DocumentExportView;
  readonly mime: string;
  readonly extension: string;
  readonly text: string;
}

function cleanFileName(value: string): string {
  const normalized = value
    .trim()
    .replace(/[\\/:*?"<>|]+/gu, "-")
    .split("")
    .filter((character) => character.charCodeAt(0) >= 32)
    .join("")
    .replace(/\s+/gu, " ")
    .replace(/^[. ]+|[. ]+$/gu, "");
  return normalized.length === 0 ? "document" : normalized.slice(0, 160);
}

function blockTitle(block: DocumentBlock): string {
  return block.label.trim() || `Block ${block.order + 1}`;
}

function translationById(
  translation: DocumentTranslationPackage | undefined,
): ReadonlyMap<string, { readonly translatedText: string }> {
  return new Map(
    (translation?.blocks ?? []).map((block) => [
      block.id,
      { translatedText: block.translatedText },
    ]),
  );
}

function blockText(block: DocumentBlock, translatedText: string, view: DocumentExportView): string {
  const source = block.text.trim();
  const translated = translatedText.trim();
  if (view === "source") return source;
  if (view === "translated") return translated.length > 0 ? translated : source;
  if (translated.length === 0 || translated === source) return source;
  return `${source}\n\n> ${translated.replace(/\n/gu, "\n> ")}`;
}

function markdownFor(
  content: DocumentContentPackage,
  translation: DocumentTranslationPackage | undefined,
  view: DocumentExportView,
): string {
  const title = content.metadata.title?.trim() || content.sourceName;
  const lines = [`# ${title}`, ""];
  if (content.metadata.author !== undefined) lines.push(`> 作者：${content.metadata.author}`);
  if (content.metadata.language !== undefined) lines.push(`> 语言：${content.metadata.language}`);
  if (translation !== undefined) {
    lines.push(`> 译文：${translation.targetLanguage}`, "");
  }
  const translated = translationById(translation);
  for (const [index, block] of content.blocks.entries()) {
    const text = blockText(block, translated.get(block.id)?.translatedText ?? "", view);
    if (text.length === 0) continue;
    const heading = block.kind === "heading" || block.kind === "page";
    lines.push(heading ? `## ${blockTitle(block)}` : `**${blockTitle(block)}**`, "", text, "");
    if (index < content.blocks.length - 1) lines.push("---", "");
  }
  return `${lines
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim()}\n`;
}

function textFor(
  content: DocumentContentPackage,
  translation: DocumentTranslationPackage | undefined,
  view: DocumentExportView,
): string {
  const translated = translationById(translation);
  return `${content.blocks
    .map((block) => {
      const text = blockText(block, translated.get(block.id)?.translatedText ?? "", view);
      return text.length === 0 ? "" : `${blockTitle(block)}\n${text}`;
    })
    .filter(Boolean)
    .join("\n\n")}\n`;
}

/** Build the lossless JSON envelope shared by Reader, Manga and Document. */
export function createDocumentExportBundle(
  content: DocumentContentPackage,
  translation?: DocumentTranslationPackage,
): DocumentExportBundle {
  return {
    version: 1,
    content,
    ...(translation === undefined ? {} : { translation }),
  };
}

/** Decode an exported bundle without allowing malformed payloads across apps. */
export function decodeDocumentExportBundle(value: unknown): DocumentExportBundle | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as {
    readonly version?: unknown;
    readonly content?: unknown;
    readonly translation?: unknown;
  };
  if (candidate.version !== 1) return undefined;
  const content = decodeDocumentContentPackage(candidate.content);
  if (content === undefined) return undefined;
  if (candidate.translation === undefined) return { version: 1, content };
  const translation = decodeDocumentTranslationPackage(candidate.translation);
  if (translation === undefined) return undefined;
  const blockIds = new Set(content.blocks.map((block) => block.id));
  if (translation.sourceContentId !== content.id) return undefined;
  if (translation.blocks.some((block) => !blockIds.has(block.id))) return undefined;
  return { version: 1, content, translation };
}

/** Serialize a canonical package without coupling core code to browser APIs. */
export function serializeDocumentExport(
  content: DocumentContentPackage,
  translation: DocumentTranslationPackage | undefined,
  format: DocumentExportFormat,
  view: DocumentExportView = translation === undefined ? "source" : "bilingual",
): DocumentExportPayload {
  if (format === "json") {
    return {
      format,
      view,
      mime: "application/json;charset=utf-8",
      extension: "json",
      text: `${JSON.stringify(createDocumentExportBundle(content, translation), null, 2)}\n`,
    };
  }
  if (format === "markdown") {
    return {
      format,
      view,
      mime: "text/markdown;charset=utf-8",
      extension: "md",
      text: markdownFor(content, translation, view),
    };
  }
  return {
    format,
    view,
    mime: "text/plain;charset=utf-8",
    extension: "txt",
    text: textFor(content, translation, view),
  };
}

export function documentExportFileName(
  sourceName: string,
  payload: Pick<DocumentExportPayload, "extension" | "view">,
): string {
  const base = cleanFileName(sourceName).replace(/\.[^./\\]+$/u, "");
  const suffix = payload.view === "bilingual" ? "-bilingual" : `-${payload.view}`;
  return `${base}${suffix}.${payload.extension}`;
}
