/** Two compositor-driven phases; change the actual page only while the sheet is hidden. */
export function animatePageEffect(
  viewport: HTMLElement,
  destination: number,
  complete: () => void,
  effect: "fade" | "paper",
): () => void {
  const forward = destination > viewport.scrollLeft;
  const direction = forward ? -1 : 1;
  const paper = effect === "paper";
  const perspective = Math.max(1000, viewport.clientWidth * 2);
  const flat = `perspective(${perspective}px) rotateY(0deg)`;
  const folded = (angle: number) => `perspective(${perspective}px) rotateY(${angle}deg)`;
  const outgoing: Keyframe[] = paper
    ? [
        { transform: flat, opacity: 1 },
        { transform: folded(direction * 55), opacity: 1, offset: 0.7 },
        { transform: folded(direction * 90), opacity: 0 },
      ]
    : [{ opacity: 1 }, { opacity: 0 }];
  const incoming: Keyframe[] = paper
    ? [
        { transform: folded(-direction * 90), opacity: 0 },
        { transform: folded(-direction * 55), opacity: 1, offset: 0.3 },
        { transform: flat, opacity: 1 },
      ]
    : [{ opacity: 0 }, { opacity: 1 }];
  const origin = viewport.style.transformOrigin;
  viewport.dataset.pageTurning = "true";
  if (paper) {
    viewport.dataset.pageEffect = "paper";
    viewport.style.transformOrigin = forward ? "left center" : "right center";
  }
  let active = true;
  let motion = viewport.animate(outgoing, {
    duration: paper ? 150 : 90,
    easing: "ease-in",
    fill: "forwards",
  });
  const cleanup = () => {
    active = false;
    motion.cancel();
    viewport.style.transformOrigin = origin;
    delete viewport.dataset.pageTurning;
    delete viewport.dataset.pageEffect;
  };
  motion.onfinish = () => {
    if (!active) return;
    viewport.scrollTo({ left: destination, behavior: "instant" });
    motion.cancel();
    if (paper) viewport.style.transformOrigin = forward ? "right center" : "left center";
    motion = viewport.animate(incoming, {
      duration: paper ? 180 : 130,
      easing: "ease-out",
      fill: "forwards",
    });
    motion.onfinish = () => {
      if (!active) return;
      cleanup();
      complete();
    };
  };
  return () => {
    if (active) cleanup();
  };
}
