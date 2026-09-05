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
import { readerFontStack } from "./readerTypography";
import { SectionView } from "./SectionView";
import { PagedReadingView } from "./PagedReadingView";
import { getReaderState, reader, useReader } from "./store";
import { READER_CAPTURE_PROGRESS_EVENT } from "./useReaderRuntime";
import { useReaderMobile } from "./useReaderMobile";

export function ReadingView(props: {
  runtime: ReaderRuntime;
  book: ReaderBook;
  onToggleMobileChrome: () => void;
}) {
  const layout = useReader((state) => state.settings.layout);
  return layout === "paged" && props.book.source.format !== "pdf" ? (
    <PagedReadingView book={props.book} onToggleMobileChrome={props.onToggleMobileChrome} />
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
  const containerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const lastScrollUpdateRef = useRef(0);
  const userScrollRef = useRef(false);
  const userScrollTimerRef = useRef<number | null>(null);
  const programmaticScrollRef = useRef(false);
  const programmaticScrollTargetRef = useRef<ReaderScrollPosition | null>(null);
  const programmaticScrollTimerRef = useRef<number | null>(null);
  const navigationRetryFrameRef = useRef<number | null>(null);
  const navigationRetryTimerRef = useRef<number | null>(null);
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
  const updateLocator = useCallback(() => {
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
  }, [activeSectionId, props.book, settings.layout]);
  useEffect(() => {
    const capture = () => {
      // Rapid consecutive jumps must retain the requested destination, not
      // capture the previous DOM before its navigation frame has committed.
      if (
        programmaticScrollRef.current ||
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
      frame = window.requestAnimationFrame(() => {
        frame = null;
        setContentReadyVersion((version) => version + 1);
      });
    };
    window.addEventListener("resize", scheduleCalibration);
    window.visualViewport?.addEventListener("resize", scheduleCalibration);
    void document.fonts?.ready.then(scheduleCalibration);
    return () => {
      cancelled = true;
      if (frame !== null) window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", scheduleCalibration);
      window.visualViewport?.removeEventListener("resize", scheduleCalibration);
    };
  }, [props.book.id]);
  useLayoutEffect(() => {
    if (activeSectionId === null || containerRef.current === null) return;
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
      userScrollRef.current = false;
      return;
    }
    if (programmaticScrollTimerRef.current !== null) {
      window.clearTimeout(programmaticScrollTimerRef.current);
    }
    if (navigationRetryFrameRef.current !== null) {
      window.cancelAnimationFrame(navigationRetryFrameRef.current);
    }
    if (navigationRetryTimerRef.current !== null) {
      window.clearTimeout(navigationRetryTimerRef.current);
    }
    // A scroll captured before a new restore/jump must not commit after it.
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    let cancelled = false;
    let attempt = 0;
    const retryDelays = [0, 50, 140, 280, 520] as const;
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
      // Browsers clamp offsets (and can round fractional values). Compare
      // subsequent events to the applied position, not an unreachable target.
      programmaticScrollTargetRef.current = {
        top: container.scrollTop,
        left: container.scrollLeft,
      };
      if (programmaticScrollTimerRef.current !== null)
        window.clearTimeout(programmaticScrollTimerRef.current);
      programmaticScrollTimerRef.current = window.setTimeout(() => {
        programmaticScrollRef.current = false;
        programmaticScrollTargetRef.current = null;
        programmaticScrollTimerRef.current = null;
      }, 720);
      if (attempt >= retryDelays.length - 1) return;
      attempt += 1;
      navigationRetryTimerRef.current = window.setTimeout(() => {
        navigationRetryFrameRef.current = window.requestAnimationFrame(attemptScroll);
      }, retryDelays[attempt]);
    };
    navigationRetryFrameRef.current = window.requestAnimationFrame(attemptScroll);
    return () => {
      cancelled = true;
      if (navigationRetryFrameRef.current !== null) {
        window.cancelAnimationFrame(navigationRetryFrameRef.current);
        navigationRetryFrameRef.current = null;
      }
      if (navigationRetryTimerRef.current !== null) {
        window.clearTimeout(navigationRetryTimerRef.current);
        navigationRetryTimerRef.current = null;
      }
    };
  }, [
    activeSectionId,
    contentReadyVersion,
    navigationSequence,
    progress,
    props.book,
    savedProgress,
    settings,
  ]);
  useEffect(() => {
    const reveal = searchReveal;
    if (
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
      if (programmaticScrollTimerRef.current !== null) {
        window.clearTimeout(programmaticScrollTimerRef.current);
        programmaticScrollTimerRef.current = null;
      }
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
  }, [activeSectionId, contentReadyVersion, props.book.id, searchQuery, searchReveal]);
  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      if (userScrollTimerRef.current !== null) {
        window.clearTimeout(userScrollTimerRef.current);
      }
      if (programmaticScrollTimerRef.current !== null) {
        window.clearTimeout(programmaticScrollTimerRef.current);
      }
      if (navigationRetryFrameRef.current !== null) {
        window.cancelAnimationFrame(navigationRetryFrameRef.current);
      }
      if (navigationRetryTimerRef.current !== null) {
        window.clearTimeout(navigationRetryTimerRef.current);
      }
    },
    [],
  );
  return (
    <div
      className={`reader-reading-frame reader-layout-scroll reader-width-${settings.contentWidth}`}
      style={
        {
          "--reader-reader-font-size": `${settings.fontSize}px`,
          "--reader-reader-line-height": settings.lineHeight,
          "--reader-reader-font-family": readerFontStack(settings),
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
        onScroll={() => {
          if (programmaticScrollRef.current) {
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
            programmaticScrollTargetRef.current = null;
            if (programmaticScrollTimerRef.current !== null) {
              window.clearTimeout(programmaticScrollTimerRef.current);
              programmaticScrollTimerRef.current = null;
            }
            if (navigationRetryFrameRef.current !== null) {
              window.cancelAnimationFrame(navigationRetryFrameRef.current);
              navigationRetryFrameRef.current = null;
            }
            if (navigationRetryTimerRef.current !== null) {
              window.clearTimeout(navigationRetryTimerRef.current);
              navigationRetryTimerRef.current = null;
            }
          }
          if (frameRef.current !== null) return;
          const flush = () => {
            // Navigation can take ownership after this scroll was queued but
            // before its animation frame runs. Never recapture that old event.
            if (programmaticScrollRef.current) {
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
          ) : (
            <PublicationSections
              book={props.book}
              activeSectionId={searchQuery ? activeSectionId : null}
              searchQuery={searchQuery}
            />
          )}
          <ReadingEnd book={props.book} />
        </div>
      </div>
      {!mobile && <ChapterRail book={props.book} />}
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
