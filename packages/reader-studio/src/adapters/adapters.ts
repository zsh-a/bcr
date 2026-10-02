import type {
  ReaderAdapter,
  ReaderBook,
  ReaderFormat,
  ReaderOpenInput,
  ReaderSection,
} from "@bcr/reader-core";
import type { DocumentContentPackage, DocumentTranslationPackage } from "@bcr/document-core";
import { openCbz, openDocx, openEpub } from "./readerArchiveAdapters";
import { formatForFile } from "./formats";
import { makeBook } from "./readerAdapterShared";
import { safeUrl, sanitizeHtml } from "./readerMarkup";
import { openPdf, readerPdfDocument } from "./readerPdfAdapter";
import { openText } from "./readerTextAdapters";
import { readSectionContent, releaseBookResources } from "../content/readerContent";
export { displayFormat, formatForFile } from "./formats";
export { readerAcceptAttribute } from "./formats";
export { safeUrl, sanitizeInlineStyle } from "./readerMarkup";
export {
  mapPdfOutlineToToc,
  type PdfOutlineDestination,
  type PdfOutlineNode,
  type PdfOutlinePageResolver,
} from "./readerPdfAdapter";

const TEXT_FORMATS = new Set<ReaderFormat>(["txt", "markdown", "html", "fb2"]);

function readerFormatForDocument(format: DocumentContentPackage["format"]): ReaderFormat {
  return format === "image" ? "unknown" : format;
}

/**
 * Rehydrate a ReaderBook from the normalized Document contract. This path is
 * intentionally synchronous: the source file is still handed over for
 * durable storage, while parsing work has already happened in Document.
 */
export function openReaderContentPackage(
  file: File,
  id: string,
  content: DocumentContentPackage,
  translation?: DocumentTranslationPackage,
): ReaderBook {
  const format = readerFormatForDocument(content.format);
  const input: ReaderOpenInput = { file, id, format };
  const inferredTitle =
    content.metadata.title ?? content.blocks.find((block) => block.kind === "heading")?.label;
  const translatedById = new Map(
    translation?.blocks.map((block) => [block.id, block.translatedText]) ?? [],
  );
  const sections = content.blocks.map((block) => {
    const kind: ReaderSection["kind"] =
      block.kind === "image" ? "image" : block.kind === "page" ? "pdf-page" : "text";
    const translatedText = translatedById.get(block.id);
    const hasTranslation = translatedText !== undefined && translatedText.length > 0;
    const resolvedText = hasTranslation ? translatedText : block.text;
    const sanitizedHtml =
      hasTranslation || block.html === undefined ? undefined : sanitizeHtml(block.html).html;
    return {
      id: block.id,
      order: block.order,
      label: block.label,
      kind,
      text: resolvedText,
      ...(sanitizedHtml === undefined ? {} : { html: sanitizedHtml }),
      ...(block.kind === "image" && block.href !== undefined
        ? { imageUrl: safeUrl(block.href) }
        : {}),
      ...(block.pageNumber === undefined ? {} : { pageNumber: block.pageNumber }),
      ...(block.href === undefined ? {} : { href: block.href }),
    } satisfies ReaderSection;
  });
  return makeBook(input, sections, {
    ...(inferredTitle === undefined ? {} : { title: inferredTitle }),
    ...(content.metadata.author === undefined ? {} : { author: content.metadata.author }),
    ...(content.metadata.language === undefined ? {} : { language: content.metadata.language }),
  });
}

const textAdapter: ReaderAdapter = {
  id: "text",
  formats: ["txt", "markdown", "html", "fb2"],
  canHandle: ({ format }) => TEXT_FORMATS.has(format),
  open: openText,
};

const docxAdapter: ReaderAdapter = {
  id: "docx",
  formats: ["docx"],
  canHandle: ({ format }) => format === "docx",
  open: openDocx,
};

const epubAdapter: ReaderAdapter = {
  id: "epub",
  formats: ["epub"],
  canHandle: ({ format }) => format === "epub",
  open: openEpub,
};

const cbzAdapter: ReaderAdapter = {
  id: "cbz",
  formats: ["cbz"],
  canHandle: ({ format }) => format === "cbz",
  open: openCbz,
};

const pdfAdapter: ReaderAdapter = {
  id: "pdf",
  formats: ["pdf"],
  canHandle: ({ format }) => format === "pdf",
  open: openPdf,
};

const unsupportedAdapter: ReaderAdapter = {
  id: "future-formats",
  formats: ["cbr", "mobi", "azw3", "unknown"],
  canHandle: () => true,
  open: async ({ format }) => {
    throw new Error(
      `${format.toUpperCase()} 适配器尚未启用；当前可直接阅读 TXT / Markdown / HTML / FB2 / EPUB / PDF / CBZ`,
    );
  },
};

export const readerAdapters: ReadonlyArray<ReaderAdapter> = [
  textAdapter,
  docxAdapter,
  epubAdapter,
  cbzAdapter,
  pdfAdapter,
  unsupportedAdapter,
];

export async function openReaderFile(
  file: File,
  id: string,
  signal?: AbortSignal,
): Promise<ReaderBook> {
  const format = formatForFile(file);
  const adapter = readerAdapters.find((candidate) => candidate.formats.includes(format));
  if (adapter === undefined) throw new Error(`不支持的文件格式：${file.name}`);
  return adapter.open({ file, id, format, signal });
}

/** Shared page/section extraction for attachment readers; no library mutation. */
export async function readReaderFileTextPage(
  file: File,
  id: string,
  page: number,
  signal?: AbortSignal,
) {
  const book = await openReaderFile(file, id, signal);
  try {
    signal?.throwIfAborted();
    if (!Number.isSafeInteger(page) || page < 1 || page > book.sections.length)
      throw new Error("附件页码超出范围");
    const section = book.sections[page - 1]!;
    const content = await readSectionContent(section, signal);
    return {
      page,
      pages: book.sections.length,
      label: section.label,
      text: content.text,
      engine: "reader-adapters-v1",
    };
  } finally {
    releaseBookResources(book);
  }
}

/** A bounded, reusable PDF preview session, independent of native browser PDF viewers. */
export async function createReaderPdfPreview(file: File, id: string, signal?: AbortSignal) {
  const book = await openPdf({ file, id, format: "pdf", signal }, { retainDocument: true });
  const pdf = readerPdfDocument(book);
  if (!pdf || signal?.aborted) {
    releaseBookResources(book);
    signal?.throwIfAborted();
    throw new Error("无法打开 PDF 预览");
  }
  let closed = false;
  return {
    pages: pdf.numPages,
    close() {
      if (!closed) releaseBookResources(book);
      closed = true;
    },
    async render(pageNumber: number, signal?: AbortSignal) {
      signal?.throwIfAborted();
      if (
        closed ||
        !Number.isSafeInteger(pageNumber) ||
        pageNumber < 1 ||
        pageNumber > pdf.numPages
      )
        throw new Error("PDF 页码无效");
      const page = await pdf.getPage(pageNumber);
      signal?.throwIfAborted();
      const original = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({
        scale: Math.min(2, 1440 / original.width, 1440 / original.height),
      });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));
      const task = page.render({ canvas, viewport });
      const cancel = () => task.cancel();
      signal?.addEventListener("abort", cancel, { once: true });
      try {
        if (signal?.aborted) cancel();
        await task.promise;
        signal?.throwIfAborted();
        const blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (value) => (value ? resolve(value) : reject(new Error("PDF 预览生成失败"))),
            "image/png",
          ),
        );
        signal?.throwIfAborted();
        return blob;
      } finally {
        signal?.removeEventListener("abort", cancel);
        canvas.width = canvas.height = 0;
        page.cleanup();
      }
    },
  };
}
