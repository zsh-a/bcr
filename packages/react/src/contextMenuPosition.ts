/** Keep a pointer menu within the viewport, including very small windows. */
export function contextMenuPosition(
  point: { x: number; y: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  gutter = 8,
) {
  const edgeX = Math.min(gutter, viewport.width / 2);
  const edgeY = Math.min(gutter, viewport.height / 2);
  return {
    left: Math.max(edgeX, Math.min(point.x, viewport.width - size.width - edgeX)),
    top: Math.max(edgeY, Math.min(point.y, viewport.height - size.height - edgeY)),
    maxWidth: Math.max(0, viewport.width - edgeX * 2),
    maxHeight: Math.max(0, viewport.height - edgeY * 2),
  };
}
