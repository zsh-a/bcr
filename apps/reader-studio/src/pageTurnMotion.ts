import { animatePageEffect } from "./pageTurnEffect";
import type { ReaderPageAnimation } from "./model";

/** Let the browser animate scrolling without a main-thread write on every frame. */
export function animatePageTurn(
  viewport: HTMLElement,
  destination: number,
  complete: () => void,
  animation: ReaderPageAnimation = "slide",
): () => void {
  const start = viewport.scrollLeft;
  if (
    animation === "none" ||
    Math.abs(destination - start) < 1 ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    viewport.scrollTo({ left: destination, behavior: "instant" });
    complete();
    return () => {};
  }
  if ((animation === "fade" || animation === "paper") && typeof viewport.animate === "function")
    return animatePageEffect(viewport, destination, complete, animation);
  return slidePageTurn(viewport, destination, complete);
}

function slidePageTurn(
  viewport: HTMLElement,
  destination: number,
  complete: () => void,
): () => void {
  const previousSnap = viewport.style.scrollSnapType;
  viewport.style.scrollSnapType = "none";
  viewport.dataset.pageTurning = "true";
  let active = true;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const cleanup = () => {
    active = false;
    clearTimeout(idleTimer);
    clearTimeout(deadline);
    viewport.removeEventListener("scroll", onScroll);
    viewport.removeEventListener("scrollend", onScrollEnd);
    viewport.style.scrollSnapType = previousSnap;
    delete viewport.dataset.pageTurning;
  };
  const finish = () => {
    if (!active) return;
    viewport.scrollTo({ left: destination, behavior: "instant" });
    cleanup();
    complete();
  };
  const onScrollEnd = () => {
    // A cancelled previous animation may still have a queued scrollend event.
    if (Math.abs(viewport.scrollLeft - destination) < 1) finish();
  };
  const onScroll = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(onScrollEnd, 120);
  };
  // The idle listener also supports browsers without scrollend; the deadline
  // releases ownership if layout changes make the destination unreachable.
  const deadline = setTimeout(finish, 1500);
  if (!Reflect.has(viewport, "onscrollend"))
    viewport.addEventListener("scroll", onScroll, { passive: true });
  viewport.addEventListener("scrollend", onScrollEnd);
  viewport.scrollTo({ left: destination, behavior: "smooth" });
  return () => {
    if (!active) return;
    viewport.scrollTo({ left: viewport.scrollLeft, behavior: "instant" });
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
