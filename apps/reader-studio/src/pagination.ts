export function pageCount(contentWidth: number, viewportWidth: number): number {
  return Math.max(1, Math.ceil((contentWidth - 1) / Math.max(1, viewportWidth)));
}

export function pageAtOffset(offset: number, width: number, count: number): number {
  return Math.max(0, Math.min(count - 1, Math.round(offset / Math.max(1, width))));
}
