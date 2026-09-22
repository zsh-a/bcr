export interface WindowGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface ViewportSize {
  width: number;
  height: number;
}
const MARGIN = 12;
const TOP = 76;

export function fitWindow(rect: WindowGeometry, viewport: ViewportSize): WindowGeometry {
  const maxWidth = Math.max(1, viewport.width - MARGIN * 2);
  const top = Math.min(TOP, Math.max(MARGIN, viewport.height / 4));
  const maxHeight = Math.max(1, viewport.height - top - MARGIN);
  const width = Math.min(maxWidth, Math.max(Math.min(360, maxWidth), rect.width));
  const height = Math.min(maxHeight, Math.max(Math.min(420, maxHeight), rect.height));
  return {
    width,
    height,
    x: Math.min(viewport.width - MARGIN - width, Math.max(MARGIN, rect.x)),
    y: Math.min(viewport.height - MARGIN - height, Math.max(top, rect.y)),
  };
}

export function defaultWindow(viewport: ViewportSize): WindowGeometry {
  return fitWindow(
    { x: viewport.width - 488, y: viewport.height - 680, width: 464, height: 656 },
    viewport,
  );
}

export function validGeometry(value: unknown): value is WindowGeometry {
  if (typeof value !== "object" || value === null) return false;
  const rect = value as WindowGeometry;
  return (
    [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) &&
    rect.width > 0 &&
    rect.height > 0
  );
}
