import { useEffect, useState, type CSSProperties } from "react";
import { createLocator, type ReaderBook, type ReaderLocator } from "@bcr/reader-core";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  resolvePdfOutlineDestination,
  type PdfOutlineDestination,
} from "../adapters/readerPdfAdapter";
import { getReaderState, reader } from "../state/store";

interface PageLink {
  id: string;
  url?: string | undefined;
  destination?: PdfOutlineDestination;
  label: string;
  style: CSSProperties;
}

export function safePdfLink(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  try {
    const url = new URL(value);
    if (["https:", "http:", "mailto:", "tel:"].includes(url.protocol)) return url.href;
  } catch {
    /* Invalid document links remain inert. */
  }
}

export async function pdfLinkLocator(
  document: PDFDocumentProxy,
  book: ReaderBook,
  destination: PdfOutlineDestination,
): Promise<ReaderLocator | undefined> {
  const index = await resolvePdfOutlineDestination(document, destination);
  const section = index === undefined ? undefined : book.sections[index];
  if (!section) return;
  const locator = createLocator(section);
  const explicit =
    typeof destination === "string" ? await document.getDestination(destination) : destination;
  const type = explicit?.[1];
  if (typeof type !== "object" || !type || !("name" in type)) return locator;
  const page = await document.getPage(index! + 1);
  const viewport = page.getViewport({ scale: 1 });
  const top =
    type.name === "XYZ" ? explicit?.[3] : type.name === "FitH" ? explicit?.[2] : undefined;
  const left = type.name === "XYZ" ? explicit?.[2] : undefined;
  if (typeof top !== "number" || !Number.isFinite(top)) return locator;
  const point = viewport.convertToViewportPoint(
    typeof left === "number" && Number.isFinite(left) ? left : page.view[0]!,
    top,
  );
  const y = Math.max(0, Math.min(1, point[1]! / viewport.height));
  return { ...locator, progression: y, pageAnchor: { x: 0.5, y } };
}

export function PdfPageLinks({
  document,
  book,
  pageNumber,
}: {
  document: PDFDocumentProxy;
  book: ReaderBook;
  pageNumber: number;
}) {
  const [links, setLinks] = useState<PageLink[]>([]);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const page = await document.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1 });
        const annotations = await page.getAnnotations({ intent: "display" });
        const next: PageLink[] = [];
        for (const annotation of annotations) {
          if (
            annotation.subtype !== "Link" ||
            !Array.isArray(annotation.rect) ||
            annotation.rect.length !== 4 ||
            !annotation.rect.every(Number.isFinite)
          )
            continue;
          const url = safePdfLink(annotation.url);
          const destination = annotation.dest as PdfOutlineDestination;
          if (!url && !destination) continue;
          const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(annotation.rect);
          next.push({
            id: String(annotation.id),
            url,
            destination,
            label: annotation.contentsObj?.str || (url ? `打开链接：${url}` : "跳转到文档内的位置"),
            style: {
              left: `${(Math.min(x1!, x2!) / viewport.width) * 100}%`,
              top: `${(Math.min(y1!, y2!) / viewport.height) * 100}%`,
              width: `${(Math.abs(x2! - x1!) / viewport.width) * 100}%`,
              height: `${(Math.abs(y2! - y1!) / viewport.height) * 100}%`,
            },
          });
        }
        if (!cancelled) setLinks(next);
      } catch {
        if (!cancelled) setLinks([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [document, pageNumber]);
  return (
    <div className="reader-pdf-links">
      {links.map((link) => (
        <a
          key={link.id}
          style={link.style}
          href={link.url ?? `#pdf-page-${pageNumber}`}
          aria-label={link.label}
          title={link.label}
          target={link.url ? "_blank" : undefined}
          rel={link.url ? "noopener noreferrer" : undefined}
          onClick={
            link.url
              ? undefined
              : (event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setError(false);
                  const sequence = getReaderState().navigationSequence;
                  void pdfLinkLocator(document, book, link.destination)
                    .then((locator) => {
                      if (
                        getReaderState().activeBookId !== book.id ||
                        getReaderState().navigationSequence !== sequence
                      )
                        return;
                      if (locator) reader.seekLocator(locator, undefined, true);
                      else setError(true);
                    })
                    .catch(() => setError(true));
                }
          }
        />
      ))}
      {error && (
        <span className="reader-pdf-link-error" role="status">
          此链接的目标页面不可用
        </span>
      )}
    </div>
  );
}
