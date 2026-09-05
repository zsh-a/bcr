import type { ReaderBook, ReaderOpenInput, ReaderSection, ReaderTocItem } from "@bcr/reader-core";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { baseSource, makeBook } from "./readerAdapterShared";

/** The destination shape returned by PDF.js outline nodes. */
export type PdfOutlineDestination = string | ReadonlyArray<unknown> | null | undefined;

/** The subset of a PDF.js outline node needed by the Reader contract. */
export interface PdfOutlineNode {
  readonly title?: unknown;
  readonly dest?: PdfOutlineDestination;
  readonly items?: ReadonlyArray<PdfOutlineNode> | undefined;
}

export type PdfOutlinePageResolver = (
  destination: PdfOutlineDestination,
) => Promise<number | undefined>;

interface PdfPageRef {
  readonly num: number;
  readonly gen: number;
}

function isPdfPageRef(value: unknown): value is PdfPageRef {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<PdfPageRef>;
  return (
    Number.isInteger(candidate.num) &&
    Number.isInteger(candidate.gen) &&
    (candidate.num ?? -1) >= 0 &&
    (candidate.gen ?? -1) >= 0
  );
}

/**
 * Resolve a PDF.js named or explicit destination to a zero-based page index.
 * Outline data is user-provided PDF content, so malformed destinations are
 * treated as unavailable targets instead of failing the whole import.
 */
async function resolvePdfOutlineDestination(
  document: PDFDocumentProxy,
  destination: PdfOutlineDestination,
): Promise<number | undefined> {
  if (
    destination !== null &&
    destination !== undefined &&
    typeof destination !== "string" &&
    !Array.isArray(destination)
  ) {
    return undefined;
  }
  try {
    const explicit: ReadonlyArray<unknown> | null =
      typeof destination === "string"
        ? await document.getDestination(destination)
        : (destination ?? null);
    const pageRef = explicit?.[0];
    if (!isPdfPageRef(pageRef)) return undefined;
    const pageIndex = await document.getPageIndex(pageRef);
    return Number.isInteger(pageIndex) && pageIndex >= 0 && pageIndex < document.numPages
      ? pageIndex
      : undefined;
  } catch {
    return undefined;
  }
}

function normalizedPdfOutlineTitle(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : "";
}

/**
 * Convert PDF.js's nested outline tree into the Reader's format-neutral TOC.
 * Page destinations are resolved by the caller so this function stays easy to
 * test and can tolerate broken entries without dropping their children.
 */
export async function mapPdfOutlineToToc(
  outline: ReadonlyArray<PdfOutlineNode> | null | undefined,
  resolvePage: PdfOutlinePageResolver,
): Promise<ReadonlyArray<ReaderTocItem>> {
  if (!Array.isArray(outline) || outline.length === 0) return [];
  const seen = new Set<object>();

  const walk = async (
    nodes: ReadonlyArray<PdfOutlineNode>,
    prefix: string,
  ): Promise<ReadonlyArray<ReaderTocItem>> => {
    const mapped = await Promise.all(
      nodes.map(async (node, index) => {
        if (typeof node !== "object" || node === null || seen.has(node)) return [];
        seen.add(node);
        const id = `pdf-toc-${prefix}.${index + 1}`;
        const children = Array.isArray(node.items)
          ? await walk(node.items, `${prefix}.${index + 1}`)
          : [];
        const label = normalizedPdfOutlineTitle(node.title);
        if (label.length === 0) return children;
        let pageIndex: number | undefined;
        try {
          pageIndex = await resolvePage(node.dest);
        } catch {
          // A single malformed destination must not hide the remaining TOC.
        }
        return [
          {
            id,
            label,
            ...(pageIndex === undefined ? {} : { sectionId: `page-${pageIndex + 1}` }),
            ...(children.length === 0 ? {} : { children }),
          } satisfies ReaderTocItem,
        ];
      }),
    );
    return mapped.flat();
  };

  return walk(outline, "root");
}

export async function openPdf(input: ReaderOpenInput): Promise<ReaderBook> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.mjs",
    import.meta.url,
  ).toString();
  const objectUrl = URL.createObjectURL(input.file);
  const loadingTask = pdfjs.getDocument(objectUrl);
  try {
    // Let PDF.js stream the Blob URL in its own worker; avoid eagerly copying
    // the entire document into a main-thread ArrayBuffer.
    const document = await loadingTask.promise;
    let toc: ReadonlyArray<ReaderTocItem> | undefined;
    try {
      const outline = await document.getOutline();
      const mapped = await mapPdfOutlineToToc(outline, (destination) =>
        resolvePdfOutlineDestination(document, destination),
      );
      if (mapped.length > 0) toc = mapped;
    } catch {
      // Some malformed PDFs expose a broken outline while their pages remain
      // readable. Keep the page reader available and fall back to page list.
    }
    const sections: ReaderSection[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      if (input.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const viewport = page.getViewport({ scale: 1 });
      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .trim();
      sections.push({
        id: `page-${pageNumber}`,
        order: pageNumber - 1,
        label: `Page ${String(pageNumber).padStart(3, "0")}`,
        kind: "pdf-page",
        text: text || `PDF page ${pageNumber}`,
        pageNumber,
        pageAspectRatio: viewport.width / viewport.height,
      });
      page.cleanup();
    }
    return {
      ...makeBook(input, sections, toc === undefined ? {} : { toc }),
      source: { ...baseSource(input, objectUrl) },
    };
  } catch (reason) {
    URL.revokeObjectURL(objectUrl);
    throw reason;
  } finally {
    await loadingTask.destroy();
  }
}
