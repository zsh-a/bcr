import { useSectionContent } from "./useSectionContent";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createLocator, type ReaderBook } from "@bcr/reader-core";
import { ChapterRail, MobileReadingBar } from "./ReaderNavigation";
import { SectionView } from "./SectionView";
import { getReaderState, reader, useReader } from "./store";
import { readerLineWidth, readerTypographyStyle } from "./readerTypography";
import {
  readerInternalLinkScrollPosition,
  readerLocatorAtScroll,
  readerLocatorScrollPosition,
} from "./readingPosition";
import { resolveReaderInternalLink, type ReaderInternalLinkTarget } from "./navigation";
import { READER_CAPTURE_PROGRESS_EVENT } from "./useReaderRuntime";
import { pageAtOffset, paginationGeometry, READER_PAGE_GUTTER } from "./pagination";
import { useReaderMobile } from "./useReaderMobile";
import { settleReaderLayout } from "./readingRestore";

/** One chapter in the DOM; one or two columns per viewport; semantic progress survives reflow. */
export function PagedReadingView(props: { book: ReaderBook; onToggleMobileChrome: () => void }) {
  const mobile = useReaderMobile();
  const settings = useReader((state) => state.settings);
  const activeId = useReader((state) => state.activeSectionId);
  const navigation = useReader((state) => state.navigationSequence);
  const query = useReader((state) => state.query);
  const reveal = useReader((state) => state.searchReveal);
  const sectionIndex = Math.max(
    0,
    props.book.sections.findIndex((section) => section.id === activeId),
  );
  const section = props.book.sections[sectionIndex];
  const activeContent = useSectionContent(section);
  const viewportRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pendingLink = useRef<ReaderInternalLinkTarget | null>(null);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(0);
  const countRef = useRef(1);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const targetPage = useRef<number | null>(null);
  const restoring = useRef(false);
  const transitioning = useRef(false);
  const queuedTurns = useRef<number[]>([]);
  const turnRef = useRef<(delta: number) => void>(() => {});
  const gesture = useRef<{ x: number; y: number; page: number } | null>(null);
  const suppressClick = useRef(false);
  const [columns, setColumns] = useState(1);
  const [physicalPages, setPhysicalPages] = useState(1);
  const [layoutBusy, setLayoutBusy] = useState(true);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const measure = () =>
      setColumns(
        settings.pageSpread &&
          frame.clientWidth -
            (frame.querySelector(".reader-chapter-rail")?.getBoundingClientRect().width ?? 0) >=
            2 * (readerLineWidth(settings) + 2 * READER_PAGE_GUTTER)
          ? 2
          : 1,
      );
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    measure();
    return () => observer.disconnect();
  }, [
    settings.pageSpread,
    settings.lineLength,
    settings.fontSize,
    settings.tocPinned,
    settings.contentWidth,
  ]);

  const capture = useCallback(() => {
    const viewport = viewportRef.current;
    if (viewport === null || section === undefined || !activeContent.ready) return;
    if (restoring.current || transitioning.current) return;
    if (getReaderState().searchOpen || document.querySelector("dialog[open]") !== null) return;
    const index = pageAtOffset(viewport.scrollLeft, viewport.clientWidth, countRef.current);
    if (
      targetPage.current !== null &&
      Math.abs(viewport.scrollLeft - targetPage.current * viewport.clientWidth) > 1
    )
      return;
    targetPage.current = null;
    setPage(index);
    const mapped = readerLocatorAtScroll(props.book, viewport, section.id);
    const locator =
      mapped?.locator.textAnchor === undefined && mapped?.locator.imageAnchor === undefined
        ? createLocator(section, index / Math.max(1, countRef.current))
        : mapped.locator;
    reader.setLocator(locator);
  }, [props.book, section, activeContent.ready]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (viewport === null || content === null || section === undefined || !activeContent.ready)
      return;
    let cancelRestore = () => {};
    let disposed = false;
    const calibrate = () => {
      if (disposed) return;
      const width = viewport.clientWidth;
      if (width <= 0) return;
      restoring.current = true;
      setLayoutBusy(true);
      targetPage.current = null;
      if (scrollTimer.current !== null) clearTimeout(scrollTimer.current);
      const gap = Number.parseFloat(getComputedStyle(content).columnGap) || 0;
      content.style.setProperty("--reader-page-content-height", `${content.clientHeight}px`);
      const origin = content.getBoundingClientRect().left;
      const fragments = Array.from(content.firstElementChild?.getClientRects() ?? []);
      const extent = fragments.reduce((end, rect) => Math.max(end, rect.right - origin), 0);
      const { totalPages: total, spreads: count } = paginationGeometry(extent, width, gap, columns);
      setPhysicalPages(total);
      countRef.current = count;
      setPages(count);
      const locator = getReaderState().progressByBook[props.book.id]?.locator;
      let target = locator?.sectionId === section.id ? Math.floor(locator.progression * count) : 0;
      if (
        locator?.sectionId === section.id &&
        (locator.textAnchor !== undefined || locator.imageAnchor !== undefined)
      ) {
        const position = readerLocatorScrollPosition(viewport, section, locator, true);
        if (position !== undefined) target = Math.floor(position.left / width);
      }
      if (pendingLink.current?.sectionId === section.id) {
        const position = readerInternalLinkScrollPosition(viewport, pendingLink.current);
        if (position !== undefined) target = Math.floor(position.left / width);
      }
      const next = Math.max(0, Math.min(count - 1, target));
      // Snap markers are committed on the next frame before applying the destination.
      cancelRestore();
      cancelRestore = settleReaderLayout(
        viewport,
        () => {
          viewport.scrollTo({ left: next * width, top: 0, behavior: "instant" });
          setPage(next);
        },
        () => {
          restoring.current = false;
          setLayoutBusy(false);
          transitioning.current = false;
          if (pendingLink.current !== null || reveal !== null) capture();
          pendingLink.current = null;
          if (reveal !== null) reader.clearSearchReveal(reveal.id);
          const turns = queuedTurns.current.splice(0);
          for (const delta of turns) turnRef.current(delta);
        },
      );
    };
    calibrate();
    const observer = new ResizeObserver(calibrate);
    observer.observe(viewport);
    content.addEventListener("load", calibrate, true);
    content.addEventListener("bcr-reader-content-ready", calibrate);
    window.addEventListener("bcr-reader-fonts-ready", calibrate);
    void document.fonts.ready.then(calibrate);
    return () => {
      disposed = true;
      observer.disconnect();
      cancelRestore();
      content.removeEventListener("load", calibrate, true);
      content.removeEventListener("bcr-reader-content-ready", calibrate);
      window.removeEventListener("bcr-reader-fonts-ready", calibrate);
    };
  }, [
    navigation,
    props.book,
    section,
    settings,
    query,
    reveal,
    capture,
    columns,
    activeContent.ready,
  ]);

  useEffect(() => {
    const flush = () => {
      const viewport = viewportRef.current;
      if (viewport && targetPage.current !== null)
        viewport.scrollTo({ left: targetPage.current * viewport.clientWidth, behavior: "instant" });
      capture();
    };
    window.addEventListener(READER_CAPTURE_PROGRESS_EVENT, flush);
    return () => {
      window.removeEventListener(READER_CAPTURE_PROGRESS_EVENT, flush);
      if (scrollTimer.current !== null) clearTimeout(scrollTimer.current);
    };
  }, [capture]);

  const turn = (delta: number) => {
    const viewport = viewportRef.current;
    if (viewport === null) return;
    if (!activeContent.ready || restoring.current || transitioning.current) {
      queuedTurns.current.push(delta);
      return;
    }
    const current =
      targetPage.current ??
      pageAtOffset(viewport.scrollLeft, viewport.clientWidth, countRef.current);
    const next = current + delta;
    if (next < 0 || next >= pages) {
      const adjacent = props.book.sections[sectionIndex + delta];
      if (adjacent !== undefined) {
        transitioning.current = true;
        targetPage.current = null;
        if (scrollTimer.current !== null) clearTimeout(scrollTimer.current);
        reader.openBook(props.book.id, adjacent.id, false);
        reader.setLocator(createLocator(adjacent, delta < 0 ? 1 : 0));
      }
    } else {
      targetPage.current = next;
      viewport.scrollTo({
        left: next * viewport.clientWidth,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
    }
  };
  turnRef.current = turn;
  return (
    <div
      ref={frameRef}
      className={`reader-reading-frame reader-paged-frame ${settings.tocPinned ? "reader-toc-pinned" : ""}`}
      style={
        {
          ...readerTypographyStyle(settings),
          "--reader-page-columns": columns,
          "--reader-page-gutter": `${READER_PAGE_GUTTER}px`,
        } as CSSProperties
      }
    >
      <div
        className="reader-reading-scroll reader-page-viewport"
        ref={viewportRef}
        tabIndex={0}
        aria-label="分页正文"
        aria-busy={layoutBusy}
        onTouchStart={(event) => {
          suppressClick.current = false;
          if (
            event.touches.length !== 1 ||
            (event.target instanceof Element &&
              event.target.closest("a,button,input,textarea,select,pre,table"))
          ) {
            gesture.current = null;
            return;
          }
          const touch = event.touches[0]!;
          targetPage.current = null;
          gesture.current = {
            x: touch.clientX,
            y: touch.clientY,
            page: pageAtOffset(
              event.currentTarget.scrollLeft,
              event.currentTarget.clientWidth,
              countRef.current,
            ),
          };
        }}
        onTouchEnd={(event) => {
          const start = gesture.current;
          gesture.current = null;
          const touch = event.changedTouches[0];
          if (!start || !touch || window.getSelection()?.isCollapsed === false) return;
          const dx = touch.clientX - start.x;
          const dy = touch.clientY - start.y;
          if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
          suppressClick.current = true;
          // Native scrolling handles in-chapter gestures; only the edge crosses a chapter.
          if ((dx < 0 && start.page === countRef.current - 1) || (dx > 0 && start.page === 0))
            turn(dx < 0 ? 1 : -1);
        }}
        onTouchCancel={() => {
          gesture.current = null;
        }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (["ArrowRight", "PageDown", "ArrowLeft", "PageUp"].includes(event.key)) {
            event.preventDefault();
            turn(event.key === "ArrowRight" || event.key === "PageDown" ? 1 : -1);
          }
        }}
        onScroll={() => {
          if (scrollTimer.current !== null) clearTimeout(scrollTimer.current);
          scrollTimer.current = setTimeout(capture, 140);
        }}
        onClick={(event) => {
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          const element = event.target instanceof Element ? event.target : null;
          const anchor = element?.closest<HTMLAnchorElement>("a[href]");
          if (anchor && section) {
            const target = resolveReaderInternalLink(
              props.book,
              section,
              anchor.getAttribute("href") ?? "",
            );
            if (target) {
              event.preventDefault();
              pendingLink.current = target;
              reader.openBook(props.book.id, target.sectionId);
            }
            return;
          }
          if (
            element?.closest("button, input, textarea, select") ||
            window.getSelection()?.isCollapsed === false
          )
            return;
          if (window.matchMedia("(max-width: 860px)").matches) props.onToggleMobileChrome();
        }}
      >
        <div ref={contentRef} className="reader-page-content">
          {section && <SectionView section={section} searchQuery={query} active />}
        </div>
        <div className="reader-page-stops" aria-hidden="true">
          {Array.from({ length: pages }, (_, index) => (
            <span key={index} style={{ left: `${index * 100}%` }} />
          ))}
        </div>
      </div>
      {!mobile && settings.tocPinned && <ChapterRail book={props.book} />}
      <MobileReadingBar
        book={props.book}
        pagination={{
          page,
          pages,
          columns,
          physicalPages,
          canPrevious: page > 0 || sectionIndex > 0,
          canNext: page < pages - 1 || sectionIndex < props.book.sections.length - 1,
          turn,
        }}
      />
    </div>
  );
}
