export const READER_PAGE_GUTTER = 24;

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
