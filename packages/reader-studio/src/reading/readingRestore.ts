/** A cancellable layout transaction shared by scroll and column readers.
 * Apply after layout, verify actual geometry, and stop once three frames agree.
 * User input always cancels ownership; image/font events may start a new transaction.
 */
export function settleReaderLayout(
  container: HTMLElement,
  apply: () => void,
  settled: () => void = () => {},
): () => void {
  let frame = 0;
  let cancelled = false;
  let previous = "";
  let stable = 0;
  let frames = 0;
  const cleanup = () => {
    container.removeEventListener("pointerdown", interrupt);
    container.removeEventListener("wheel", interrupt);
  };
  const interrupt = () => {
    cancelled = true;
    cancelAnimationFrame(frame);
    cleanup();
    settled();
  };
  container.addEventListener("pointerdown", interrupt, { passive: true });
  container.addEventListener("wheel", interrupt, { passive: true });
  const tick = () => {
    if (cancelled || !container.isConnected) {
      cleanup();
      return;
    }
    apply();
    const geometry = [
      container.clientWidth,
      container.clientHeight,
      container.scrollWidth,
      container.scrollHeight,
      container.scrollTop,
      container.scrollLeft,
    ].join(":");
    stable = geometry === previous ? stable + 1 : 0;
    previous = geometry;
    if (stable >= 3 || ++frames >= 120) {
      cleanup();
      settled();
      return;
    }
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => {
    cancelled = true;
    cancelAnimationFrame(frame);
    cleanup();
  };
}
