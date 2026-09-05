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
import { readerFontStack } from "./readerTypography";
import {
  readerInternalLinkScrollPosition,
  readerLocatorAtScroll,
  readerLocatorScrollPosition,
} from "./readingPosition";
import { resolveReaderInternalLink, type ReaderInternalLinkTarget } from "./navigation";
import { READER_CAPTURE_PROGRESS_EVENT } from "./useReaderRuntime";
import { pageAtOffset, pageCount } from "./pagination";
import { useReaderMobile } from "./useReaderMobile";

/** One chapter in the DOM; one viewport per column; navigation and progress are separate. */
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
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pendingLink = useRef<ReaderInternalLinkTarget | null>(null);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(0);
  const countRef = useRef(1);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const capture = useCallback(() => {
    const viewport = viewportRef.current;
    if (viewport === null || section === undefined) return;
    const index = pageAtOffset(viewport.scrollLeft, viewport.clientWidth, countRef.current);
    setPage(index);
    const mapped = readerLocatorAtScroll(props.book, viewport, section.id);
    const locator =
      mapped?.locator.textAnchor === undefined
        ? createLocator(section, index / Math.max(1, countRef.current))
        : mapped.locator;
    reader.setLocator(locator);
  }, [props.book, section]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (viewport === null || content === null || section === undefined) return;
    let frame = 0;
    let disposed = false;
    const calibrate = () => {
      if (disposed) return;
      const width = viewport.clientWidth;
      if (width <= 0) return;
      const count = pageCount(content.scrollWidth + 48, width);
      countRef.current = count;
      setPages(count);
      const locator = getReaderState().progressByBook[props.book.id]?.locator;
      let target = locator?.sectionId === section.id ? Math.floor(locator.progression * count) : 0;
      if (locator?.sectionId === section.id && locator.textAnchor !== undefined) {
        const position = readerLocatorScrollPosition(viewport, section, locator, true);
        if (position !== undefined) target = Math.floor(position.left / width);
      }
      if (pendingLink.current?.sectionId === section.id) {
        const position = readerInternalLinkScrollPosition(viewport, pendingLink.current);
        if (position !== undefined) target = Math.floor(position.left / width);
      }
      const next = Math.max(0, Math.min(count - 1, target));
      // Snap markers are committed on the next frame before applying the destination.
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        viewport.scrollTo({ left: next * width, top: 0, behavior: "instant" });
        setPage(next);
        if (pendingLink.current !== null || reveal !== null) capture();
        pendingLink.current = null;
        if (reveal !== null) reader.clearSearchReveal(reveal.id);
      });
    };
    calibrate();
    const observer = new ResizeObserver(calibrate);
    observer.observe(viewport);
    content.addEventListener("load", calibrate, true);
    void document.fonts.ready.then(calibrate);
    return () => {
      disposed = true;
      observer.disconnect();
      cancelAnimationFrame(frame);
      content.removeEventListener("load", calibrate, true);
    };
  }, [navigation, props.book, section, settings, query, reveal, capture]);

  useEffect(() => {
    window.addEventListener(READER_CAPTURE_PROGRESS_EVENT, capture);
    return () => {
      window.removeEventListener(READER_CAPTURE_PROGRESS_EVENT, capture);
      if (scrollTimer.current !== null) clearTimeout(scrollTimer.current);
    };
  }, [capture]);

  const turn = (delta: number) => {
    const viewport = viewportRef.current;
    if (viewport === null) return;
    const current = pageAtOffset(viewport.scrollLeft, viewport.clientWidth, pages);
    const next = current + delta;
    if (next < 0 || next >= pages) {
      const adjacent = props.book.sections[sectionIndex + delta];
      if (adjacent !== undefined) {
        reader.openBook(props.book.id, adjacent.id, false);
        if (delta < 0) reader.setLocator(createLocator(adjacent, 1));
      }
    } else {
      viewport.scrollTo({
        left: next * viewport.clientWidth,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
    }
  };
  return (
    <div
      className="reader-reading-frame reader-paged-frame"
      style={
        {
          "--reader-reader-font-size": `${settings.fontSize}px`,
          "--reader-reader-line-height": settings.lineHeight,
          "--reader-reader-font-family": readerFontStack(settings),
        } as CSSProperties
      }
    >
      <div
        className="reader-reading-scroll reader-page-viewport"
        ref={viewportRef}
        tabIndex={0}
        aria-label="分页正文"
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
          {section && <SectionView section={section} searchQuery={query} />}
        </div>
        <div className="reader-page-stops" aria-hidden="true">
          {Array.from({ length: pages }, (_, index) => (
            <span key={index} style={{ left: `${index * 100}%` }} />
          ))}
        </div>
      </div>
      {!mobile && <ChapterRail book={props.book} />}
      <MobileReadingBar
        book={props.book}
        pagination={{
          page,
          pages,
          canPrevious: page > 0 || sectionIndex > 0,
          canNext: page < pages - 1 || sectionIndex < props.book.sections.length - 1,
          turn,
        }}
      />
    </div>
  );
}
