import { animatePageTurn, pageClickDirection, PAGE_INTERACTIVE_TARGET } from "./pageTurnMotion";
import { useSectionsContent } from "./useSectionContent";
import {
  useCallback,
  useMemo,
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
import {
  pageAtOffset,
  paginationGroups,
  paginationGeometry,
  READER_PAGE_GUTTER,
} from "./pagination";
import { useReaderMobile } from "./useReaderMobile";
import { settleReaderLayout } from "./readingRestore";

/** One chapter or bounded TXT batch; semantic progress survives page turns and reflow. */
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
  const groups = useMemo(() => paginationGroups(props.book), [props.book]);
  const groupIndex = Math.max(
    0,
    groups.findIndex((group) => sectionIndex >= group.start && sectionIndex < group.end),
  );
  const group = groups[groupIndex];
  const sections = useMemo(
    () => props.book.sections.slice(group?.start ?? 0, group?.end ?? 0),
    [props.book, group],
  );
  const section = sections[0];
  const activeContent = useSectionsContent(sections);
  const neighbors = useMemo(() => {
    const previous = groups[groupIndex - 1],
      next = groups[groupIndex + 1];
    return [
      ...(previous
        ? props.book.sections.slice(Math.max(previous.start, previous.end - 2), previous.end)
        : []),
      ...(next ? props.book.sections.slice(next.start, Math.min(next.end, next.start + 2)) : []),
    ].filter(
      (item) =>
        item.kind === "text" &&
        !item.contentInfo?.imageCount &&
        (item.contentInfo?.textLength ?? item.textRange?.length ?? item.text.length) <= 24000,
    );
  }, [props.book, groups, groupIndex]);
  useSectionsContent(neighbors);
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
  const pointer = useRef<{
    id: number;
    x: number;
    y: number;
    started: number;
    moved: boolean;
    selected: boolean;
  } | null>(null);
  const cancelMotion = useRef<() => void>(() => {});
  const stopMotion = useCallback(() => {
    cancelMotion.current();
    cancelMotion.current = () => {};
  }, []);
  useEffect(() => stopMotion, [stopMotion]);
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
      stopMotion();
      restoring.current = true;
      setLayoutBusy(true);
      targetPage.current = null;
      if (scrollTimer.current !== null) clearTimeout(scrollTimer.current);
      const gap = Number.parseFloat(getComputedStyle(content).columnGap) || 0;
      content.style.setProperty("--reader-page-content-height", `${content.clientHeight}px`);
      const origin = content.getBoundingClientRect().left;
      const fragments = Array.from(content.children).flatMap((child) =>
        Array.from(child.getClientRects()),
      );
      const extent = fragments.reduce((end, rect) => Math.max(end, rect.right - origin), 0);
      const { totalPages: total, spreads: count } = paginationGeometry(extent, width, gap, columns);
      setPhysicalPages(total);
      countRef.current = count;
      setPages(count);
      const locator = getReaderState().progressByBook[props.book.id]?.locator;
      const locatedSection = sections.find((item) => item.id === locator?.sectionId);
      let target = locatedSection && locator ? Math.floor(locator.progression * count) : 0;
      if (
        locatedSection &&
        locator &&
        (sections.length > 1 || locator.textAnchor || locator.imageAnchor)
      ) {
        const position = readerLocatorScrollPosition(viewport, locatedSection, locator, true);
        if (position !== undefined) target = Math.floor(position.left / width);
      }
      if (
        pendingLink.current &&
        sections.some((item) => item.id === pendingLink.current?.sectionId)
      ) {
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
      stopMotion();
      content.removeEventListener("load", calibrate, true);
      content.removeEventListener("bcr-reader-content-ready", calibrate);
      window.removeEventListener("bcr-reader-fonts-ready", calibrate);
    };
  }, [
    navigation,
    props.book,
    section,
    sections,
    settings,
    query,
    reveal,
    capture,
    columns,
    activeContent.ready,
    stopMotion,
  ]);

  useEffect(() => {
    const flush = () => {
      stopMotion();
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
  }, [capture, stopMotion]);

  const turn = (delta: number) => {
    const viewport = viewportRef.current;
    if (viewport === null) return;
    if (!activeContent.ready || restoring.current || transitioning.current) {
      if (queuedTurns.current.length < 8) queuedTurns.current.push(delta);
      return;
    }
    const current =
      targetPage.current ??
      pageAtOffset(viewport.scrollLeft, viewport.clientWidth, countRef.current);
    const next = current + delta;
    if (next < 0 || next >= pages) {
      const adjacent = props.book.sections[delta < 0 ? (group?.start ?? 0) - 1 : (group?.end ?? 0)];
      if (adjacent !== undefined) {
        stopMotion();
        transitioning.current = true;
        targetPage.current = null;
        if (scrollTimer.current !== null) clearTimeout(scrollTimer.current);
        reader.openBook(props.book.id, adjacent.id, false);
        reader.setLocator(createLocator(adjacent, delta < 0 ? 1 : 0));
      }
    } else {
      targetPage.current = next;
      stopMotion();
      setPage(next);
      cancelMotion.current = animatePageTurn(viewport, next * viewport.clientWidth, capture);
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
        aria-description="点击左侧翻到上一页，右侧翻到下一页；也可使用方向键或空格翻页。手机点击中央显示或隐藏工具栏。"
        onPointerDown={(event) => {
          suppressClick.current = false;
          pointer.current = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            started: event.timeStamp,
            moved: !event.isPrimary || event.button !== 0,
            selected: window.getSelection()?.isCollapsed === false,
          };
        }}
        onPointerMove={(event) => {
          const start = pointer.current;
          if (
            start &&
            start.id === event.pointerId &&
            Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8
          ) {
            start.moved = true;
            stopMotion();
            targetPage.current = null;
          }
          const viewport = event.currentTarget;
          const interactive =
            event.target instanceof Element && event.target.closest(PAGE_INTERACTIVE_TARGET);
          const direction = interactive
            ? 0
            : pageClickDirection(
                event.clientX - viewport.getBoundingClientRect().left,
                viewport.clientWidth,
              );
          const zone = direction < 0 ? "previous" : direction > 0 ? "next" : "center";
          if (viewport.dataset.turnZone !== zone) viewport.dataset.turnZone = zone;
        }}
        onPointerUp={(event) => {
          const start = pointer.current;
          if (start && start.id === event.pointerId) {
            suppressClick.current =
              start.moved || start.selected || event.timeStamp - start.started > 450;
            pointer.current = null;
          }
        }}
        onPointerCancel={() => {
          pointer.current = null;
          suppressClick.current = true;
        }}
        onPointerLeave={(event) => {
          delete event.currentTarget.dataset.turnZone;
        }}
        onWheel={() => {
          stopMotion();
          targetPage.current = null;
        }}
        aria-busy={layoutBusy || !activeContent.ready}
        onTouchStart={(event) => {
          stopMotion();
          if (
            event.touches.length !== 1 ||
            (event.target instanceof Element && event.target.closest(PAGE_INTERACTIVE_TARGET))
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
          if (event.altKey || event.ctrlKey || event.metaKey) return;
          if (["ArrowRight", "PageDown", "ArrowLeft", "PageUp", " "].includes(event.key)) {
            event.preventDefault();
            turn(
              event.key === "ArrowRight" ||
                event.key === "PageDown" ||
                (event.key === " " && !event.shiftKey)
                ? 1
                : -1,
            );
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
          if (
            event.button !== 0 ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey
          )
            return;
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
            element?.closest(PAGE_INTERACTIVE_TARGET) ||
            window.getSelection()?.isCollapsed === false
          )
            return;
          const rect = event.currentTarget.getBoundingClientRect();
          const direction = pageClickDirection(event.clientX - rect.left, rect.width);
          if (event.detail > 0 && direction !== 0) turn(direction);
          else if (mobile && direction === 0) props.onToggleMobileChrome();
        }}
      >
        <div
          ref={contentRef}
          className={`reader-page-content ${props.book.source.format === "txt" ? "reader-page-text-flow" : ""}`}
        >
          {sections.map((item) => (
            <SectionView key={item.id} section={item} searchQuery={query} active />
          ))}
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
          canPrevious: page > 0 || groupIndex > 0,
          canNext: page < pages - 1 || groupIndex < groups.length - 1,
          scopeLabel: props.book.source.format === "txt" ? "当前阅读段" : "本章",
          turn,
        }}
      />
    </div>
  );
}
