import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createLocator, type ReaderBook } from "@bcr/reader-core";
import { getReaderState, reader } from "../state/store";
import { readerProbeTopOffset } from "./readingPosition";

export function fitPdfPage(width: number, height: number, aspectRatio: number): number {
  if (width <= 0 || height <= 0 || aspectRatio <= 0) return 1;
  return Math.max(0.01, Math.min(1, (height * aspectRatio) / width));
}

export function usePdfViewport(root: RefObject<HTMLDivElement | null>, ratio: number) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = root.current;
    const scroll = element?.closest<HTMLElement>(".reader-reading-scroll");
    if (!element || !scroll) return;
    const measure = () => {
      const footer = scroll.closest(".reader-reading-frame")?.querySelector(".reader-mobile-nav");
      const height = Math.max(
        1,
        scroll.clientHeight -
          readerProbeTopOffset(scroll) -
          (footer?.getBoundingClientRect().height ?? 0) -
          12,
      );
      const width = element.clientWidth;
      setSize((previous) =>
        previous.width === width && previous.height === height ? previous : { width, height },
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    observer.observe(scroll);
    const studio = scroll.closest(".reader-studio");
    const mutations = new MutationObserver(measure);
    if (studio) mutations.observe(studio, { attributes: true, attributeFilter: ["class"] });
    window.visualViewport?.addEventListener("resize", measure);
    measure();
    return () => {
      observer.disconnect();
      mutations.disconnect();
      window.visualViewport?.removeEventListener("resize", measure);
    };
  }, [root]);
  return fitPdfPage(size.width, size.height, ratio);
}

/** Pinch previews use a compositor transform; commit one render when fingers lift. */
export function usePdfGestures(
  root: RefObject<HTMLDivElement | null>,
  book: ReaderBook,
  zoom: number,
  changeZoom: (value: number) => void,
) {
  const latest = useRef({ zoom, changeZoom });
  latest.current = { zoom, changeZoom };
  useEffect(() => {
    const element = root.current;
    const scroll = element?.closest<HTMLElement>(".reader-reading-scroll");
    if (!element || !scroll) return;
    let gesture: {
      distance: number;
      zoom: number;
      scale: number;
      point: { x: number; y: number };
      canvas: HTMLElement;
      sectionId: string;
      x: number;
      y: number;
    } | null = null;
    let lastTap: { time: number; x: number; y: number } | undefined;
    let start: { x: number; y: number } | undefined;
    let suppressClick = false;
    let clickTimer = 0;
    let frame = 0;
    const blockClick = () => {
      window.dispatchEvent(new Event("bcr-reader-pdf-gesture"));
      suppressClick = true;
      window.clearTimeout(clickTimer);
      clickTimer = window.setTimeout(() => {
        suppressClick = false;
      }, 400);
    };
    const click = (event: MouseEvent) => {
      if (suppressClick) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const capture = (point: { x: number; y: number }, canvas: HTMLElement) => {
      const rect = canvas.getBoundingClientRect();
      return {
        canvas,
        point,
        sectionId: canvas.closest<HTMLElement>("[data-reader-section]")!.dataset.readerSection!,
        x: (point.x - rect.left) / rect.width,
        y: (point.y - rect.top) / rect.height,
      };
    };
    const commit = (anchor: ReturnType<typeof capture>, next: number) => {
      const section = book.sections.find((s) => s.id === anchor.sectionId);
      if (!section) return;
      window.dispatchEvent(new Event("bcr-reader-capture-progress"));
      latest.current.changeZoom(next);
      const sequence = getReaderState().navigationSequence;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (
          !anchor.canvas.isConnected ||
          getReaderState().activeBookId !== book.id ||
          getReaderState().navigationSequence !== sequence
        )
          return;
        const rect = anchor.canvas.getBoundingClientRect();
        const bounds = scroll.getBoundingClientRect();
        const x = anchor.x + (bounds.left + bounds.width * 0.5 - anchor.point.x) / rect.width;
        const y =
          anchor.y + (bounds.top + readerProbeTopOffset(scroll) - anchor.point.y) / rect.height;
        reader.seekLocator({
          ...createLocator(section, Math.max(0, Math.min(1, y))),
          pageAnchor: { x, y },
        });
      });
    };
    const touchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      const canvas = (event.target as Element).closest<HTMLElement>(".reader-pdf-canvas-shell");
      if (!canvas || (event.target as Element).closest("a,button,input,select")) return;
      start = { x: touch.clientX, y: touch.clientY };
      if (event.touches.length !== 2) return;
      event.preventDefault();
      const second = event.touches[1]!;
      const point = {
        x: (touch.clientX + second.clientX) / 2,
        y: (touch.clientY + second.clientY) / 2,
      };
      window.getSelection()?.removeAllRanges();
      gesture = {
        ...capture(point, canvas),
        distance: Math.max(
          1,
          Math.hypot(touch.clientX - second.clientX, touch.clientY - second.clientY),
        ),
        zoom: latest.current.zoom,
        scale: 1,
      };
      blockClick();
    };
    const touchMove = (event: TouchEvent) => {
      if (!gesture || event.touches.length !== 2) return;
      event.preventDefault();
      const [a, b] = event.touches;
      const next = Math.max(
        0.1,
        Math.min(
          4,
          (gesture.zoom * Math.hypot(a!.clientX - b!.clientX, a!.clientY - b!.clientY)) /
            gesture.distance,
        ),
      );
      gesture.scale = next / gesture.zoom;
      gesture.canvas.style.transformOrigin = `${gesture.x * 100}% ${gesture.y * 100}%`;
      gesture.canvas.style.transform = `scale(${gesture.scale})`;
      blockClick();
    };
    const touchEnd = (event: TouchEvent) => {
      if (gesture) {
        event.preventDefault();
        const value = gesture;
        gesture = null;
        value.canvas.style.transform = "";
        value.canvas.style.transformOrigin = "";
        if (event.type !== "touchcancel") commit(value, value.zoom * value.scale);
        blockClick();
        lastTap = undefined;
        start = undefined;
        return;
      }
      const touch = event.changedTouches[0];
      if (
        event.type === "touchcancel" ||
        !touch ||
        !start ||
        event.touches.length ||
        Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > 12
      ) {
        lastTap = undefined;
        return;
      }
      const canvas = (event.target as Element).closest<HTMLElement>(".reader-pdf-canvas-shell");
      if (
        !canvas ||
        (event.target as Element).closest("a,button") ||
        window.getSelection()?.isCollapsed === false
      )
        return;
      const time = performance.now();
      if (
        lastTap &&
        time - lastTap.time < 300 &&
        Math.hypot(touch.clientX - lastTap.x, touch.clientY - lastTap.y) < 28
      ) {
        event.preventDefault();
        blockClick();
        commit(
          capture({ x: touch.clientX, y: touch.clientY }, canvas),
          latest.current.zoom > 1.1 ? 1 : 2,
        );
        lastTap = undefined;
      } else lastTap = { time, x: touch.clientX, y: touch.clientY };
    };
    element.addEventListener("touchstart", touchStart, { passive: false });
    element.addEventListener("touchmove", touchMove, { passive: false });
    element.addEventListener("touchend", touchEnd, { passive: false });
    element.addEventListener("touchcancel", touchEnd, { passive: false });
    element.addEventListener("click", click, true);
    return () => {
      element.removeEventListener("touchstart", touchStart);
      element.removeEventListener("touchmove", touchMove);
      element.removeEventListener("touchend", touchEnd);
      element.removeEventListener("touchcancel", touchEnd);
      element.removeEventListener("click", click, true);
      cancelAnimationFrame(frame);
      window.clearTimeout(clickTimer);
      if (gesture) {
        gesture.canvas.style.transform = "";
        gesture.canvas.style.transformOrigin = "";
      }
    };
  }, [root, book]);
}
