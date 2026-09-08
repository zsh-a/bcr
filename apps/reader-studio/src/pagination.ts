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

/** Layout batches do not change the source sections or their citation offsets. */
export function paginationGroups(book: ReaderBook) {
  const groups: { start: number; end: number }[] = [];
  const boundaries = new Set(book.toc?.map((item) => item.sectionId));
  let start = 0,
    length = 0;
  for (let index = 0; index < book.sections.length; index++) {
    const section = book.sections[index]!;
    const size =
      section.contentInfo?.textLength ?? section.textRange?.length ?? section.text.length;
    if (
      index > start &&
      (book.source.format !== "txt" ||
        boundaries.has(section.id) ||
        index - start >= 32 ||
        length + size > 24000)
    ) {
      groups.push({ start, end: index });
      start = index;
      length = 0;
    }
    length += size;
  }
  if (start < book.sections.length) groups.push({ start, end: book.sections.length });
  return groups;
}
