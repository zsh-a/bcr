/** Observe once: after a preview is shown, scrolling must not reread or replace its Blob URL. */
export function observePreviewVisibility(element: Element, show: () => void): () => void {
  if (typeof IntersectionObserver === "undefined") {
    show();
    return () => {};
  }
  let live = true;
  const observer = new IntersectionObserver(
    (entries) => {
      if (!live || !entries.some((entry) => entry.target === element && entry.isIntersecting))
        return;
      live = false;
      observer.disconnect();
      show();
    },
    { root: element.closest(".cm-scroller, .knowledge-content"), rootMargin: "600px" },
  );
  observer.observe(element);
  return () => {
    live = false;
    observer.disconnect();
  };
}
