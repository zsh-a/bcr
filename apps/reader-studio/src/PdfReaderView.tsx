import { CircleAlert, ChevronLeft, ChevronRight, Minus, Plus } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { searchTextRanges, type ReaderBook, type ReaderSection } from "@bcr/reader-core";
import { clamp } from "./readerPresentation";
import { getReaderState, reader, useReader } from "./store";
import { createRenderQueue } from "./renderQueue";

export function PdfReaderView(props: { book: ReaderBook; onReady?: () => void }) {
  const activeSectionId = useReader((state) => state.activeSectionId);
  const query = useReader((state) => state.query);
  const hit = useReader((state) => state.searchHits[state.searchActiveIndex]);
  const searchBookId = useReader((state) => state.searchBookId);
  const navigationSequence = useReader((state) => state.navigationSequence);
  const [zoom, setZoom] = useState(1);
  const rootRef = useRef<HTMLDivElement>(null);
  const toolsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const scroll = rootRef.current?.closest<HTMLElement>(".reader-reading-scroll");
    if (!scroll) return;
    const followHorizontalPan = () => {
      if (toolsRef.current) toolsRef.current.style.translate = `${scroll.scrollLeft}px 0`;
    };
    followHorizontalPan();
    scroll.addEventListener("scroll", followHorizontalPan, { passive: true });
    return () => scroll.removeEventListener("scroll", followHorizontalPan);
  }, [props.book.id]);
  const [pageInput, setPageInput] = useState("");
  const editingPage = useRef(false);
  const currentPage =
    Math.max(
      0,
      props.book.sections.findIndex((section) => section.id === activeSectionId),
    ) + 1;
  useEffect(() => {
    if (!editingPage.current) setPageInput(String(currentPage));
  }, [currentPage]);
  useEffect(() => setZoom(1), [props.book.id]);
  const goPage = (page: number) => {
    const section = props.book.sections[page - 1];
    if (section !== undefined) reader.openBook(props.book.id, section.id);
  };
  const changeZoom = (next: number) => {
    const root = rootRef.current;
    const scroll = root?.closest<HTMLElement>(".reader-reading-scroll");
    const page = root?.querySelector<HTMLElement>(
      `[data-reader-section="${CSS.escape(activeSectionId ?? "")}"]`,
    );
    const offset =
      scroll && page
        ? (scroll.getBoundingClientRect().top - page.getBoundingClientRect().top) /
          Math.max(1, page.offsetHeight)
        : 0;
    setZoom(clamp(next, 0.4, 3));
    requestAnimationFrame(() => {
      if (
        getReaderState().navigationSequence !== navigationSequence ||
        getReaderState().activeBookId !== props.book.id
      )
        return;
      if (scroll && page)
        scroll.scrollTo({
          top:
            scroll.scrollTop +
            page.getBoundingClientRect().top -
            scroll.getBoundingClientRect().top +
            offset * page.offsetHeight,
          left: 0,
          behavior: "instant",
        });
    });
  };
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const renderQueue = useMemo(() => createRenderQueue(), [props.book.id]);
  const sourceUrl = props.book.source.objectUrl;
  const sourcePending = sourceUrl === undefined && props.book.source.ref !== undefined;
  useEffect(() => {
    let cancelled = false;
    let opened: PDFDocumentProxy | undefined;
    let loadingTask: { destroy: () => Promise<void> } | undefined;
    setPdfDocument(null);
    setLoading(true);
    setError(null);
    if (sourceUrl === undefined) {
      if (!sourcePending) {
        setError("PDF 源文件未恢复");
        setLoading(false);
      }
      return () => {
        cancelled = true;
      };
    }
    const load = async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.mjs",
          import.meta.url,
        ).toString();
        if (cancelled) return;
        const task = pdfjs.getDocument(sourceUrl);
        loadingTask = task;
        const document = await task.promise;
        opened = document;
        if (cancelled) {
          await document.destroy();
          return;
        }
        setPdfDocument(document);
        setLoading(false);
        props.onReady?.();
      } catch (reason) {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (opened !== undefined) void opened.destroy();
      else if (loadingTask !== undefined) void loadingTask.destroy();
    };
  }, [sourcePending, sourceUrl, loadAttempt]);

  return (
    <div className="reader-pdf-view" ref={rootRef}>
      <div ref={toolsRef} className="reader-pdf-tools" aria-label="PDF 页码与缩放">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const value = Number(pageInput);
            if (Number.isInteger(value) && value >= 1 && value <= props.book.sections.length) {
              goPage(value);
              event.currentTarget.querySelector("input")?.blur();
            }
          }}
        >
          <button
            type="button"
            aria-label="PDF 上一页"
            disabled={currentPage <= 1}
            onClick={() => goPage(currentPage - 1)}
          >
            <ChevronLeft className="reader-icon" />
          </button>
          <label>
            <span className="reader-visually-hidden">PDF 页码</span>
            <input
              aria-label="PDF 页码"
              inputMode="numeric"
              type="number"
              min="1"
              max={props.book.sections.length}
              value={pageInput}
              enterKeyHint="go"
              onFocus={() => {
                editingPage.current = true;
              }}
              onChange={(event) => setPageInput(event.target.value)}
              onBlur={() => {
                editingPage.current = false;
                setPageInput(String(currentPage));
              }}
            />
          </label>
          <span>/ {props.book.sections.length}</span>
          <button type="submit" className="reader-visually-hidden">
            跳转到 PDF 页码
          </button>
          <button
            type="button"
            aria-label="PDF 下一页"
            disabled={currentPage >= props.book.sections.length}
            onClick={() => goPage(currentPage + 1)}
          >
            <ChevronRight className="reader-icon" />
          </button>
        </form>
        <div>
          <button
            type="button"
            aria-label="缩小 PDF"
            disabled={zoom <= 0.4}
            onClick={() => changeZoom(zoom - 0.25)}
          >
            <Minus className="reader-icon" />
          </button>
          <select
            aria-label="PDF 缩放"
            value={String(zoom)}
            onChange={(event) => {
              if (event.target.value === "page") {
                const height =
                  rootRef.current?.closest<HTMLElement>(".reader-reading-scroll")?.clientHeight ??
                  600;
                const width = rootRef.current?.clientWidth ?? 600;
                const ratio =
                  props.book.sections[currentPage - 1]?.pageAspectRatio ?? 1 / Math.SQRT2;
                changeZoom(((height - 100) * ratio) / width);
              } else changeZoom(Number(event.target.value));
            }}
          >
            <option value={String(zoom)}>{Math.round(zoom * 100)}%</option>
            {zoom !== 1 && <option value="1">适合宽度</option>}
            <option value="page">适合整页</option>
            {[1.5, 2, 3]
              .filter((value) => value !== zoom)
              .map((value) => (
                <option key={value} value={String(value)}>
                  {value * 100}%
                </option>
              ))}
          </select>
          <button
            type="button"
            aria-label="放大 PDF"
            disabled={zoom >= 3}
            onClick={() => changeZoom(zoom + 0.25)}
          >
            <Plus className="reader-icon" />
          </button>
        </div>
      </div>
      {loading && (
        <div className="reader-media-loading">
          {sourcePending ? "正在从本地恢复 PDF…" : "正在打开 PDF…"}
        </div>
      )}
      {error !== null && (
        <div className="reader-media-error" role="alert">
          <CircleAlert className="reader-icon" />
          <span>{error}</span>
          <button
            type="button"
            className="reader-media-retry"
            onClick={() => setLoadAttempt((attempt) => attempt + 1)}
          >
            重试
          </button>
        </div>
      )}
      {pdfDocument !== null && (
        <div
          className="reader-pdf-pages"
          aria-label="PDF 连续页面"
          style={{ width: `${zoom * 100}%` }}
        >
          {props.book.sections.map((section) => (
            <PdfPageView
              key={section.id}
              document={pdfDocument}
              section={section}
              active={section.id === activeSectionId}
              renderQueue={renderQueue}
              query={query}
              navigationSequence={navigationSequence}
              matchStart={
                navigationSequence > 0 &&
                searchBookId === props.book.id &&
                hit?.bookId === props.book.id &&
                hit.sectionId === section.id
                  ? hit.matchStart
                  : undefined
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

type PdfPageStatus = "idle" | "loading" | "ready" | "error";

const PdfPageView = memo(function PdfPageView(props: {
  document: PDFDocumentProxy;
  section: ReaderSection;
  active: boolean;
  renderQueue: ReturnType<typeof createRenderQueue>;
  query: string;
  navigationSequence: number;
  matchStart: number | undefined;
}) {
  const pageNumber = props.section.pageNumber ?? props.section.order + 1;
  const pageShellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [textRevision, setTextRevision] = useState(0);
  const textStrings = useRef<ReadonlyArray<string>>([]);
  const focusedMatch = useRef("");
  const [hasText, setHasText] = useState(true);
  const [nearViewport, setNearViewport] = useState(props.active || pageNumber <= 2);
  const [contentWidth, setContentWidth] = useState(0);
  const [status, setStatus] = useState<PdfPageStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [renderAttempt, setRenderAttempt] = useState(0);

  useEffect(() => {
    const element = pageShellRef.current;
    if (element === null) return;
    const updateWidth = () => {
      const width = element.clientWidth;
      if (width > 0) setContentWidth(width);
    };
    updateWidth();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateWidth);
      return () => window.removeEventListener("resize", updateWidth);
    }
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = pageShellRef.current;
    if (element === null) return;
    if (typeof IntersectionObserver === "undefined") {
      setNearViewport(true);
      return;
    }
    const root = element.closest<HTMLElement>(".reader-reading-scroll");
    const observer = new IntersectionObserver(
      (entries) => {
        setNearViewport(entries.some((entry) => entry.isIntersecting));
      },
      { root, rootMargin: "600px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    if (!nearViewport || contentWidth <= 0) {
      canvas.width = 0;
      canvas.height = 0;
      setStatus("idle");
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    let renderTask: { cancel: () => void; promise: Promise<unknown> } | undefined;
    let textLayer: { cancel: () => void } | undefined;
    let page: { cleanup: () => void } | undefined;
    setStatus("loading");
    setError(null);
    const render = async () => {
      try {
        const loadedPage = await props.document.getPage(pageNumber);
        page = loadedPage;
        if (cancelled) {
          loadedPage.cleanup();
          return;
        }
        const baseViewport = loadedPage.getViewport({ scale: 1 });
        const targetWidth = Math.max(1, contentWidth - 2);
        // Bound backing pixels even at 300% zoom; CSS/text remain full resolution.
        const deviceScale = Math.min(
          clamp(window.devicePixelRatio || 1, 1, 2),
          Math.sqrt(
            4_000_000 / ((targetWidth * targetWidth * baseViewport.height) / baseViewport.width),
          ),
        );
        const cssScale = targetWidth / baseViewport.width;
        const viewport = loadedPage.getViewport({ scale: cssScale * deviceScale });
        const context = canvas.getContext("2d");
        if (context === null) throw new Error("Canvas 2D 不可用");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        canvas.style.width = `${Math.ceil(viewport.width / deviceScale)}px`;
        canvas.style.height = `${Math.ceil(viewport.height / deviceScale)}px`;
        renderTask = loadedPage.render({ canvas, canvasContext: context, viewport });
        await renderTask.promise;
        if (cancelled) return;
        const container = textRef.current;
        if (container !== null) {
          const { TextLayer } = await import("pdfjs-dist");
          if (cancelled) return;
          container.replaceChildren();
          container.style.setProperty("--total-scale-factor", String(cssScale));
          const layer = new TextLayer({
            textContentSource: await loadedPage.getTextContent(),
            container,
            viewport: loadedPage.getViewport({ scale: cssScale }),
          });
          textLayer = layer;
          if (cancelled) {
            layer.cancel();
            return;
          }
          await layer.render();
          if (cancelled) return;
          textStrings.current = layer.textContentItemsStr;
          setHasText(layer.textContentItemsStr.some((text) => text.trim()));
          setTextRevision((value) => value + 1);
        }
        if (!cancelled) setStatus("ready");
      } catch (reason) {
        if (cancelled) return;
        setStatus("error");
        setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        page?.cleanup();
      }
    };
    void props.renderQueue(controller.signal, render).catch(() => undefined);
    return () => {
      cancelled = true;
      controller.abort();
      renderTask?.cancel();
      textLayer?.cancel();
      textRef.current?.replaceChildren();
      page?.cleanup();
      canvas.width = 0;
      canvas.height = 0;
    };
  }, [contentWidth, nearViewport, pageNumber, props.document, props.renderQueue, renderAttempt]);

  useEffect(() => {
    const container = textRef.current;
    if (container === null || status !== "ready") return;
    const spans = [...container.querySelectorAll<HTMLSpanElement>("span[role='presentation']")];
    const text = textStrings.current.join("");
    const ranges = searchTextRanges(text, props.query, 1000);
    const original = searchTextRanges(props.section.text, props.query, 1000);
    const selected = original.findIndex((range) => range.start === props.matchStart);
    let offset = 0;
    let target: HTMLElement | undefined;
    spans.forEach((span, index) => {
      const value = textStrings.current[index] ?? "";
      span.replaceChildren();
      let cursor = 0;
      ranges.forEach((range, ordinal) => {
        const from = Math.max(0, range.start - offset);
        const to = Math.min(value.length, range.start + range.length - offset);
        if (from >= to) return;
        span.append(document.createTextNode(value.slice(cursor, from)));
        const mark = document.createElement("mark");
        mark.textContent = value.slice(from, to);
        mark.dataset.readerSearchMatch = "true";
        if (ordinal === selected) {
          mark.className = "is-current";
          target ??= mark;
        }
        span.append(mark);
        cursor = to;
      });
      span.append(document.createTextNode(value.slice(cursor)));
      offset += value.length;
    });
    const focusKey = `${props.navigationSequence}:${props.query}:${props.matchStart}`;
    if (
      target !== undefined &&
      props.matchStart !== undefined &&
      focusedMatch.current !== focusKey
    ) {
      focusedMatch.current = focusKey;
      target.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
    }
  }, [
    props.query,
    props.matchStart,
    props.section.text,
    props.navigationSequence,
    textRevision,
    status,
  ]);

  return (
    <section
      ref={pageShellRef}
      className={`reader-pdf-page ${props.active ? "is-active" : ""}`}
      data-reader-section={props.section.id}
      data-reader-section-index={props.section.order}
      aria-label={`PDF 第 ${pageNumber} 页`}
    >
      <div className="reader-pdf-page-meta">
        <span>PAGE {String(pageNumber).padStart(3, "0")}</span>
        {props.active && (
          <strong>{!hasText && status === "ready" ? "扫描页 · 无文字层" : "当前页"}</strong>
        )}
      </div>
      <div
        className={`reader-pdf-canvas-shell is-${status}`}
        style={{ aspectRatio: props.section.pageAspectRatio ?? 1 / Math.SQRT2 }}
      >
        {status === "idle" && <span className="reader-pdf-placeholder">滚动到此处加载页面</span>}
        {status === "loading" && <span className="reader-media-loading">正在渲染页面…</span>}
        {status === "error" && (
          <div className="reader-media-error" role="alert">
            <CircleAlert className="reader-icon" />
            <span>{error ?? "页面渲染失败"}</span>
            <button
              type="button"
              className="reader-media-retry"
              onClick={() => setRenderAttempt((attempt) => attempt + 1)}
            >
              重试本页
            </button>
          </div>
        )}
        <canvas ref={canvasRef} className="reader-pdf-canvas" />
        <div ref={textRef} className="reader-pdf-text-layer" />
      </div>
    </section>
  );
});
