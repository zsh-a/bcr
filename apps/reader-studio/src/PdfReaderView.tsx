import { CircleAlert } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { ReaderBook, ReaderSection } from "@bcr/reader-core";
import { clamp } from "./readerPresentation";
import { useReader } from "./store";
import { createRenderQueue } from "./renderQueue";

export function PdfReaderView(props: { book: ReaderBook; onReady?: () => void }) {
  const activeSectionId = useReader((state) => state.activeSectionId);
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
    <div className="reader-pdf-view">
      <div className="reader-pdf-meta">
        <span>PDF · {props.book.sections.length} 页</span>
        <span>连续阅读 · 进入视口后按需渲染</span>
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
        <div className="reader-pdf-pages" aria-label="PDF 连续页面">
          {props.book.sections.map((section) => (
            <PdfPageView
              key={section.id}
              document={pdfDocument}
              section={section}
              active={section.id === activeSectionId}
              renderQueue={renderQueue}
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
}) {
  const pageNumber = props.section.pageNumber ?? props.section.order + 1;
  const pageShellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
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
        const targetWidth = Math.max(1, Math.min(contentWidth - 2, 840));
        const deviceScale = clamp(window.devicePixelRatio || 1, 1, 2);
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
      page?.cleanup();
      canvas.width = 0;
      canvas.height = 0;
    };
  }, [contentWidth, nearViewport, pageNumber, props.document, props.renderQueue, renderAttempt]);

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
        {props.active && <strong>当前页</strong>}
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
      </div>
    </section>
  );
});
