import { isLazyTxt } from "./lazyTxt";
import { useTxtSection } from "./useTxtSection";
import { Check } from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createLocator, locatorAtPercentage, type ReaderBook } from "@bcr/reader-core";
import type { ReaderRuntime } from "./runtime";
import { PdfReaderView } from "./PdfReaderView";
import { ChapterRail, MobileReadingBar } from "./ReaderNavigation";
import { resolveReaderInternalLink, type ReaderInternalLinkTarget } from "./navigation";
import {
  readerInternalLinkScrollPosition,
  readerLocatorAtScroll,
  readerLocatorScrollPosition,
  readerScrollPercentage,
  readerSectionScrollPosition,
  readerUsesHorizontalPaging,
  scrollToReaderSection,
  type ReaderScrollPosition,
} from "./readingPosition";
import { formatBadge, percent } from "./readerPresentation";
import { readerTypographyStyle } from "./readerTypography";
import { useReaderFonts } from "./useReaderFonts";
import { VirtualTextSections, SECTION_WINDOW_THRESHOLD } from "./VirtualTextSections";
import { SectionView } from "./SectionView";
import { PagedReadingView } from "./PagedReadingView";
import { getReaderState, reader, useReader } from "./store";
import { READER_CAPTURE_PROGRESS_EVENT } from "./useReaderRuntime";
import { useReaderMobile } from "./useReaderMobile";
import { ComicReadingView } from "./ComicReadingView";
import { settleReaderLayout } from "./readingRestore";

export function ReadingView(props: {
  runtime: ReaderRuntime;
  book: ReaderBook;
  onToggleMobileChrome: () => void;
}) {
  const layout = useReader((state) => state.settings.layout);
  const comic = useReader((state) => state.settings.books?.[props.book.id]?.comic);
  const settings = useReader((state) => state.settings);
  const comicMode =
    comic ??
    (props.book.source.format === "cbz" || props.book.rendition?.layout === "pre-paginated");
  useReaderFonts(settings, props.book.source.format !== "pdf" && !comicMode);
  if (comicMode) return <ComicReadingView book={props.book} />;
  return layout === "paged" && props.book.source.format !== "pdf" ? (
    <PagedReadingView
      key={props.book.id}
      book={props.book}
      onToggleMobileChrome={props.onToggleMobileChrome}
    />
  ) : (
    <ContinuousReadingView {...props} />
  );
}

function ContinuousReadingView(props: {
  runtime: ReaderRuntime;
  book: ReaderBook;
  onToggleMobileChrome: () => void;
}) {
  const mobile = useReaderMobile();
  const settings = useReader((state) => state.settings);
  const activeSectionId = useReader((state) => state.activeSectionId);
  const navigationSequence = useReader((state) => state.navigationSequence);
  const savedProgress = useReader((state) => state.progressByBook[props.book.id]);
  const progress = savedProgress?.percentage ?? 0;
  const searchQuery = useReader((state) => state.query);
  const searchReveal = useReader((state) => state.searchReveal);
  const activeContent = useTxtSection(
    props.book.sections.find((section) => section.id === activeSectionId),
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const lastScrollUpdateRef = useRef(0);
  const userScrollRef = useRef(false);
  const userScrollTimerRef = useRef<number | null>(null);
  const programmaticScrollRef = useRef(false);
  const layoutCalibrationRef = useRef(false);
  const programmaticScrollTargetRef = useRef<ReaderScrollPosition | null>(null);
  const restoreCancelRef = useRef<(() => void) | null>(null);
  const pendingInternalLinkRef = useRef<ReaderInternalLinkTarget | null>(null);
  const handledNavigationSequenceRef = useRef(navigationSequence);
  const [contentReadyVersion, setContentReadyVersion] = useState(0);
  const markUserScroll = useCallback(() => {
    userScrollRef.current = true;
    if (userScrollTimerRef.current !== null) window.clearTimeout(userScrollTimerRef.current);
    userScrollTimerRef.current = window.setTimeout(() => {
      userScrollRef.current = false;
      userScrollTimerRef.current = null;
    }, 240);
  }, []);
  const beginUserScroll = useCallback(() => {
    restoreCancelRef.current?.();
    programmaticScrollRef.current = false;
    programmaticScrollTargetRef.current = null;
    layoutCalibrationRef.current = false;
    markUserScroll();
  }, [markUserScroll]);
  const updateLocator = useCallback(() => {
    if (layoutCalibrationRef.current || !activeContent.ready) return;
    // Search and modal surfaces occlude the caret probes. Measuring through
    // them can replace a valid text anchor with a different paragraph/page.
    if (getReaderState().searchOpen || document.querySelector("dialog[open]") !== null) return;
    const container = containerRef.current;
    if (container === null || props.book.sections.length === 0) return;
    const percentage = readerScrollPercentage(container, settings.layout);
    const mapped = readerLocatorAtScroll(props.book, container, activeSectionId);
    reader.setLocator(
      mapped?.locator ?? locatorAtPercentage(props.book, percentage),
      mapped?.percentage ?? percentage,
    );
  }, [activeSectionId, props.book, settings.layout, activeContent.ready]);
  useEffect(() => {
    const capture = () => {
      if (getReaderState().searchOpen || document.querySelector("dialog[open]") !== null) return;
      // Rapid consecutive jumps must retain the requested destination, not
      // capture the previous DOM before its navigation frame has committed.
      if (
        programmaticScrollRef.current ||
        layoutCalibrationRef.current ||
        getReaderState().navigationSequence !== handledNavigationSequenceRef.current
      )
        return;
      markUserScroll();
      updateLocator();
    };
    window.addEventListener(READER_CAPTURE_PROGRESS_EVENT, capture);
    return () => window.removeEventListener(READER_CAPTURE_PROGRESS_EVENT, capture);
  }, [markUserScroll, updateLocator]);
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    let frame: number | null = null;
    let cancelled = false;
    const scheduleCalibration = () => {
      if (cancelled || frame !== null) return;
      // Resizing/loading can produce native scroll anchoring events before
      // React reapplies the saved locator. These are not reading gestures.
      layoutCalibrationRef.current = true;
      userScrollRef.current = false;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        setContentReadyVersion((version) => version + 1);
      });
    };
    const contentLoaded = () => {
      if (!userScrollRef.current) scheduleCalibration();
    };
    container.addEventListener("bcr-reader-content-ready", contentLoaded);
    window.addEventListener("resize", scheduleCalibration);
    window.addEventListener("bcr-reader-fonts-ready", scheduleCalibration);
    container.addEventListener("load", scheduleCalibration, true);
    window.visualViewport?.addEventListener("resize", scheduleCalibration);
    void document.fonts?.ready.then(scheduleCalibration);
    return () => {
      cancelled = true;
      if (frame !== null) window.cancelAnimationFrame(frame);
      container.removeEventListener("bcr-reader-content-ready", contentLoaded);
      window.removeEventListener("resize", scheduleCalibration);
      window.removeEventListener("bcr-reader-fonts-ready", scheduleCalibration);
      container.removeEventListener("load", scheduleCalibration, true);
      window.visualViewport?.removeEventListener("resize", scheduleCalibration);
    };
  }, [props.book.id]);
  useLayoutEffect(() => {
    if (activeSectionId === null || containerRef.current === null || !activeContent.ready) return;
    const explicitNavigation = navigationSequence !== handledNavigationSequenceRef.current;
    const pendingInternalLink =
      explicitNavigation && pendingInternalLinkRef.current?.sectionId === activeSectionId
        ? pendingInternalLinkRef.current
        : null;
    if (explicitNavigation) {
      handledNavigationSequenceRef.current = navigationSequence;
      pendingInternalLinkRef.current = null;
      userScrollRef.current = false;
    } else if (userScrollRef.current) {
      layoutCalibrationRef.current = false;
      return;
    }
    restoreCancelRef.current?.();
    // A scroll captured before a new restore/jump must not commit after it.
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    let cancelled = false;
    const attemptScroll = () => {
      if (cancelled) return;
      const container = containerRef.current;
      if (container === null) return;
      const horizontalPaging = readerUsesHorizontalPaging(container, settings.layout);
      const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
      const maxLeft = Math.max(0, container.scrollWidth - container.clientWidth);
      const activeSection = props.book.sections.find((section) => section.id === activeSectionId);
      const activeLocator =
        savedProgress?.locator.sectionId === activeSectionId
          ? savedProgress.locator
          : activeSection === undefined
            ? undefined
            : createLocator(activeSection);
      const sectionPosition = readerSectionScrollPosition(container, activeSectionId);
      const locatorPosition =
        activeSection === undefined || activeLocator === undefined
          ? undefined
          : readerLocatorScrollPosition(container, activeSection, activeLocator, horizontalPaging);
      const internalLinkPosition =
        pendingInternalLink === null
          ? undefined
          : readerInternalLinkScrollPosition(container, pendingInternalLink);
      const position =
        internalLinkPosition === undefined
          ? horizontalPaging
            ? explicitNavigation
              ? (locatorPosition ?? sectionPosition ?? { top: 0, left: maxLeft * progress })
              : (locatorPosition ?? { top: 0, left: maxLeft * progress })
            : {
                top: locatorPosition?.top ?? maxTop * progress,
                left: 0,
              }
          : horizontalPaging
            ? { top: 0, left: internalLinkPosition.left }
            : { top: internalLinkPosition.top, left: 0 };
      programmaticScrollRef.current = true;
      programmaticScrollTargetRef.current = position;
      // PDF canvases can change the height of pages above the destination
      // after the first paint. Recalculate and reapply a few times so a TOC
      // click remains reliable while lazy pages settle.
      container.scrollTo({ ...position, behavior: "instant" });
      layoutCalibrationRef.current = false;
      // Browsers clamp offsets (and can round fractional values). Compare
      // subsequent events to the applied position, not an unreachable target.
      programmaticScrollTargetRef.current = {
        top: container.scrollTop,
        left: container.scrollLeft,
      };
    };
    restoreCancelRef.current = settleReaderLayout(containerRef.current, attemptScroll, () => {
      programmaticScrollRef.current = false;
      programmaticScrollTargetRef.current = null;
      if (isLazyTxt(props.book) && searchReveal) reader.clearSearchReveal(searchReveal.id);
    });
    return () => {
      cancelled = true;
      restoreCancelRef.current?.();
      programmaticScrollRef.current = false;
    };
  }, [
    activeSectionId,
    contentReadyVersion,
    activeContent.ready,
    navigationSequence,
    progress,
    props.book,
    savedProgress,
    settings,
  ]);
  useEffect(() => {
    const reveal = searchReveal;
    if (
      isLazyTxt(props.book) ||
      !activeContent.ready ||
      reveal === null ||
      reveal.bookId !== props.book.id ||
      reveal.sectionId !== activeSectionId ||
      searchQuery.trim() === ""
    ) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      // A reveal supersedes the section navigation scroll that may still be
      // settling. Its own instant scroll should be allowed to establish the
      // finer-grained progress without being mistaken for a user gesture.
      programmaticScrollRef.current = false;
      programmaticScrollTargetRef.current = null;
      restoreCancelRef.current?.();
      // The first mark is the same first occurrence used by the core search
      // index. If a format cannot expose text marks (for example PDF), keep
      // the chapter/page context rather than leaving the user at the old
      // scroll position.
      const container = containerRef.current;
      const section = props.book.sections.find((item) => item.id === reveal.sectionId);
      const locator = savedProgress?.locator;
      const position =
        container && section && locator
          ? readerLocatorScrollPosition(container, section, locator, false)
          : undefined;
      if (container && position) container.scrollTo({ ...position, behavior: "instant" });
      else scrollToReaderSection(reveal.sectionId, "instant");
      reader.clearSearchReveal(reveal.id);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    activeSectionId,
    contentReadyVersion,
    props.book.id,
    searchQuery,
    searchReveal,
    activeContent.ready,
  ]);
  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      if (userScrollTimerRef.current !== null) {
        window.clearTimeout(userScrollTimerRef.current);
      }
      restoreCancelRef.current?.();
    },
    [],
  );
  return (
    <div
      className={`reader-reading-frame reader-layout-scroll reader-width-${settings.contentWidth} ${settings.tocPinned ? "reader-toc-pinned" : ""}`}
      style={
        {
          ...readerTypographyStyle(settings),
        } as CSSProperties
      }
    >
      <div
        className="reader-reading-scroll"
        ref={containerRef}
        onClick={(event) => {
          const anchor =
            event.target instanceof Element
              ? event.target.closest<HTMLAnchorElement>(".reader-prose a[href]")
              : null;
          if (anchor !== null && props.book.source.format === "epub") {
            const sourceSectionId =
              anchor.closest<HTMLElement>("[data-reader-section]")?.dataset.readerSection;
            const sourceSection = props.book.sections.find(
              (section) => section.id === sourceSectionId,
            );
            const href = anchor.getAttribute("href");
            const target =
              sourceSection === undefined || href === null
                ? undefined
                : resolveReaderInternalLink(props.book, sourceSection, href);
            if (target !== undefined) {
              event.preventDefault();
              pendingInternalLinkRef.current = target;
              reader.openBook(props.book.id, target.sectionId);
              return;
            }
          }
          if (!window.matchMedia("(max-width: 860px)").matches) return;
          if (
            event.target instanceof Element &&
            event.target.closest("a, button, input, textarea, select")
          ) {
            return;
          }
          if (window.getSelection()?.isCollapsed === false) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < bounds.left + bounds.width * 0.22 ||
            event.clientX > bounds.right - bounds.width * 0.22
          ) {
            return;
          }
          props.onToggleMobileChrome();
        }}
        onWheel={beginUserScroll}
        onTouchMove={beginUserScroll}
        onScroll={() => {
          if (layoutCalibrationRef.current || !activeContent.ready) return;
          if (programmaticScrollRef.current) {
            if (isLazyTxt(props.book)) return;
            const expected = programmaticScrollTargetRef.current;
            const current = {
              top: containerRef.current?.scrollTop ?? 0,
              left: containerRef.current?.scrollLeft ?? 0,
            };
            // Ignore the event generated by our own auto-scroll. A scroll that
            // lands elsewhere is a user gesture (for example immediately
            // dragging a freshly loaded PDF to its last page).
            if (
              expected !== null &&
              Math.abs(current.top - expected.top) <= 8 &&
              Math.abs(current.left - expected.left) <= 8
            )
              return;
            programmaticScrollRef.current = false;
            restoreCancelRef.current?.();
            programmaticScrollTargetRef.current = null;
          }
          if (frameRef.current !== null) return;
          const flush = () => {
            // Navigation can take ownership after this scroll was queued but
            // before its animation frame runs. Never recapture that old event.
            if (programmaticScrollRef.current || layoutCalibrationRef.current) {
              frameRef.current = null;
              return;
            }
            const elapsed = performance.now() - lastScrollUpdateRef.current;
            if (elapsed < 120) {
              frameRef.current = requestAnimationFrame(flush);
              return;
            }
            frameRef.current = null;
            lastScrollUpdateRef.current = performance.now();
            markUserScroll();
            updateLocator();
          };
          frameRef.current = requestAnimationFrame(flush);
        }}
      >
        <div className="reader-reading-column">
          <ReadingIntro book={props.book} progress={progress} />
          {props.book.source.format === "pdf" ? (
            <PdfReaderView
              book={props.book}
              onReady={() => setContentReadyVersion((version) => version + 1)}
            />
          ) : props.book.source.format === "txt" &&
            props.book.sections.length > SECTION_WINDOW_THRESHOLD ? (
            <VirtualTextSections
              key={props.book.id}
              book={props.book}
              activeSectionId={activeSectionId}
              searchQuery={searchQuery}
              scrollRef={containerRef}
              typographyKey={JSON.stringify(readerTypographyStyle(settings))}
            />
          ) : (
            <PublicationSections
              book={props.book}
              activeSectionId={activeSectionId}
              searchQuery={searchQuery}
            />
          )}
          <ReadingEnd book={props.book} />
        </div>
      </div>
      {!mobile && settings.tocPinned && <ChapterRail book={props.book} />}
      <MobileReadingBar book={props.book} />
    </div>
  );
}

function ReadingIntro(props: { book: ReaderBook; progress: number }) {
  const unit = props.book.source.format === "pdf" ? "页" : "章节";
  return (
    <section className="reader-reading-intro">
      <div className="reader-intro-kicker">
        <span className="reader-live-dot" /> {formatBadge(props.book.source.format)} ·{" "}
        {props.book.sections.length} 个{unit}
      </div>
      <h1>{props.book.title}</h1>
      <p className="reader-intro-author">{props.book.author ?? "本地出版物"}</p>
      <div className="reader-intro-line">
        <span />
        {props.progress > 0 ? `从 ${percent(props.progress)} 继续` : "从头开始阅读"}
        <span />
      </div>
    </section>
  );
}

const PublicationSections = memo(function PublicationSections(props: {
  book: ReaderBook;
  activeSectionId: string | null;
  searchQuery: string;
}) {
  return props.book.sections.map((section) => (
    <SectionView
      key={section.id}
      section={section}
      active={section.id === props.activeSectionId}
      searchQuery={section.id === props.activeSectionId ? props.searchQuery : ""}
    />
  ));
});

function ReadingEnd(props: { book: ReaderBook }) {
  return (
    <div className="reader-reading-end">
      <Check className="reader-icon" />
      <strong>读到这里</strong>
      <span>{props.book.title} · 进度已保存在当前设备</span>
    </div>
  );
}
