import { useLayoutEffect, type RefObject } from "react";

/** Keep mobile modal controls above the software keyboard without resizing the page behind it. */
export function useModalViewport(ref: RefObject<HTMLElement | null>, open: boolean) {
  useLayoutEffect(() => {
    const element = ref.current;
    const viewport = window.visualViewport;
    if (!open || !element || !viewport) return;
    const update = () => {
      // Pinch zoom should magnify the existing surface, not relayout its controls.
      if (viewport.scale !== 1) return;
      element.style.setProperty("--modal-viewport-height", `${viewport.height}px`);
      element.style.setProperty("--modal-viewport-top", `${viewport.offsetTop}px`);
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      element.style.removeProperty("--modal-viewport-height");
      element.style.removeProperty("--modal-viewport-top");
    };
  }, [ref, open]);
}
