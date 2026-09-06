/** A short, cancellable slide. Scroll snapping resumes only after the final position is applied. */
export function animatePageTurn(
  viewport: HTMLElement,
  destination: number,
  complete: () => void,
): () => void {
  const start = viewport.scrollLeft;
  const distance = destination - start;
  if (Math.abs(distance) < 1 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    viewport.scrollTo({ left: destination, behavior: "instant" });
    complete();
    return () => {};
  }
  const previousSnap = viewport.style.scrollSnapType;
  viewport.style.scrollSnapType = "none";
  viewport.dataset.pageTurning = "true";
  const started = performance.now();
  const duration = Math.min(
    260,
    180 + (Math.abs(distance) / Math.max(1, viewport.clientWidth)) * 30,
  );
  let frame = 0;
  let cancelled = false;
  const cleanup = () => {
    viewport.style.scrollSnapType = previousSnap;
    delete viewport.dataset.pageTurning;
  };
  const tick = (now: number) => {
    if (cancelled) return;
    const progress = Math.min(1, (now - started) / duration);
    const eased = 1 - (1 - progress) ** 3;
    viewport.scrollTo({ left: start + distance * eased, behavior: "instant" });
    if (progress < 1) frame = requestAnimationFrame(tick);
    else {
      cleanup();
      viewport.scrollTo({ left: destination, behavior: "instant" });
      complete();
    }
  };
  frame = requestAnimationFrame(tick);
  return () => {
    cancelled = true;
    cancelAnimationFrame(frame);
    cleanup();
  };
}

export function pageClickDirection(x: number, width: number): -1 | 0 | 1 {
  if (width <= 0 || x < 0 || x > width) return 0;
  if (x < width * 0.25) return -1;
  if (x > width * 0.75) return 1;
  return 0;
}

export const PAGE_INTERACTIVE_TARGET =
  "a,button,input,textarea,select,summary,[contenteditable]:not([contenteditable=false]),[role=button],audio,video,pre,table";
