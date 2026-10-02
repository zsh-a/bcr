import type { ReaderBook } from "@bcr/reader-core";

export const READER_PAGE_GUTTER = 24;

/** Fit whole line boxes without changing the reader's chosen line spacing. */
export function pageTextHeight(available: number, lineHeight: number): number {
  if (!Number.isFinite(available) || available <= 0) return 0;
  if (!Number.isFinite(lineHeight) || lineHeight <= 0 || available < lineHeight) return available;
  // Round upward to the browser's layout unit so fractional line heights cannot
  // make the final line spill into another column.
  const step = Math.ceil(lineHeight * 64) / 64;
  return Math.floor(available / step) * step;
}

export function paginationGeometry(
  extent: number,
  viewportWidth: number,
  gap: number,
  columns: number,
) {
  const totalPages = pageCount(extent + gap, viewportWidth / Math.max(1, columns));
  return { totalPages, spreads: Math.ceil(totalPages / Math.max(1, columns)) };
}

export function pageCount(contentWidth: number, viewportWidth: number): number {
  return Math.max(1, Math.ceil((contentWidth - 1) / Math.max(1, viewportWidth)));
}

export function pageAtOffset(offset: number, width: number, count: number): number {
  return Math.max(0, Math.min(count - 1, Math.round(offset / Math.max(1, width))));
}

/** Structured publications retain their publisher-defined chapter boundaries.
 * TXT uses TxtPageLayout and does not create paragraph-group page boundaries. */
export function paginationGroups(book: ReaderBook) {
  return book.sections.map((_, start) => ({ start, end: start + 1 }));
}
