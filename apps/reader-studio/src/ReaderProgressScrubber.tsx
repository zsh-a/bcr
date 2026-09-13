import { locatorAtPercentage, type ReaderBook, type ReaderLocator } from "@bcr/reader-core";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { currentTxtChapter } from "./txtChapters";
import { READER_PDF_DOCUMENT_EVENT, readerPdfDocument } from "./readerPdfAdapter";
import { clamp, percent } from "./readerPresentation";
import { reader, useReader } from "./store";
import { READER_CAPTURE_PROGRESS_EVENT, READER_SEEK_PROGRESS_EVENT } from "./useReaderRuntime";

function seekLocatorAtPercentage(book: ReaderBook, value: number): ReaderLocator {
  const locator = locatorAtPercentage(book, clamp(value, 0, 1));
  const section = book.sections.find((item) => item.id === locator.sectionId);
  const imageCount = section?.contentInfo?.imageCount ?? 0;
  if (section?.kind !== "image" && imageCount <= 0) return locator;

  const count = Math.max(1, imageCount);
  return {
    ...locator,
    imageAnchor: {
      index: Math.min(count - 1, Math.floor(locator.progression * count)),
      x: 0.5,
      y: 0,
    },
  };
}

export function ReaderProgressScrubber(props: { book: ReaderBook }) {
  const activeSectionId = useReader((state) => state.activeSectionId);
  const progress = useReader((state) => state.progressByBook[props.book.id]?.percentage ?? 0);
  const [draft, setDraft] = useState(progress);
  const [dragging, setDragging] = useState(false);
  const draftRef = useRef(progress);
  const committedRef = useRef(progress);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    if (dragging) return;
    const next = clamp(progress, 0, 1);
    draftRef.current = next;
    committedRef.current = next;
    setDraft(next);
  }, [dragging, progress]);

  const commit = () => {
    const next = clamp(draftRef.current, 0, 1);
    setDragging(false);
    if (Math.abs(next - committedRef.current) < 0.0005) return;
    committedRef.current = next;
    window.dispatchEvent(new Event(READER_CAPTURE_PROGRESS_EVENT));
    reader.seekLocator(seekLocatorAtPercentage(props.book, next), next);
    window.dispatchEvent(new Event(READER_SEEK_PROGRESS_EVENT));
  };

  const chapter = currentTxtChapter(props.book, activeSectionId);
  const section = props.book.sections.find((item) => item.id === activeSectionId);
  const context = chapter?.label ?? section?.label ?? "全书进度";
  const previewLocator = locatorAtPercentage(props.book, clamp(draft, 0, 1));
  const previewSection = props.book.sections.find((item) => item.id === previewLocator.sectionId);
  const previewChapter = currentTxtChapter(props.book, previewSection?.id ?? null);
  const previewContext = previewChapter?.label ?? previewSection?.label ?? context;
  const style = { "--reader-progress": `${draft * 100}%` } as CSSProperties;

  return (
    <section className={`reader-progress-dock ${dragging ? "is-dragging" : ""}`} style={style}>
      <ReaderProgressPreview
        book={props.book}
        section={previewSection}
        context={previewContext}
        visible={dragging}
      />
      <div className="reader-progress-dock-meta">
        <span className="reader-progress-dock-label">READING PROGRESS</span>
        <strong title={dragging ? previewContext : context}>
          {dragging ? previewContext : context}
        </strong>
        <output htmlFor="reader-progress-range">{percent(draft)}</output>
      </div>
      <div className="reader-progress-range">
        <input
          id="reader-progress-range"
          type="range"
          min="0"
          max="1"
          step="0.001"
          value={draft}
          aria-label="调整全书阅读进度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(draft * 100)}
          aria-valuetext={`${percent(draft)}，${dragging ? previewContext : context}`}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture?.(event.pointerId);
            window.dispatchEvent(new Event(READER_CAPTURE_PROGRESS_EVENT));
            setDragging(true);
          }}
          onPointerUp={commit}
          onPointerCancel={commit}
          onChange={(event) => {
            const next = clamp(Number(event.target.value), 0, 1);
            draftRef.current = next;
            setDraft(next);
          }}
          onKeyDown={() => setDragging(true)}
          onKeyUp={commit}
          onBlur={commit}
        />
      </div>
    </section>
  );
}

function previewSnippet(section: ReaderBook["sections"][number] | undefined): string {
  if (section === undefined) return "拖动滑块，快速定位到阅读位置";
  const text = section.text.replace(/\s+/gu, " ").trim();
  return text.slice(0, 86) || section.label || "当前位置";
}

function ReaderProgressPreview(props: {
  book: ReaderBook;
  section: ReaderBook["sections"][number] | undefined;
  context: string;
  visible: boolean;
}) {
  const sectionIndex =
    props.section === undefined ? -1 : props.book.sections.indexOf(props.section);
  const pageNumber = props.section?.pageNumber ?? sectionIndex + 1;
  const isPdf = props.book.source.format === "pdf" && pageNumber > 0;
  return (
    <div className="reader-progress-preview" aria-hidden={!props.visible}>
      <div className="reader-progress-preview-media">
        {isPdf ? (
          <PdfProgressThumbnail book={props.book} pageNumber={pageNumber} visible={props.visible} />
        ) : (
          <div className="reader-progress-preview-paper">
            <span>{props.book.source.format.toUpperCase()}</span>
            <i />
            <i />
            <i />
            <i />
          </div>
        )}
      </div>
      <div className="reader-progress-preview-copy">
        <span>
          {isPdf
            ? `PDF · 第 ${pageNumber} 页 / ${props.book.sections.length}`
            : `${Math.max(1, sectionIndex + 1)} / ${props.book.sections.length}`}
        </span>
        <strong>{props.context}</strong>
        <p>{previewSnippet(props.section)}</p>
      </div>
    </div>
  );
}

function PdfProgressThumbnail(props: { book: ReaderBook; pageNumber: number; visible: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [documentVersion, setDocumentVersion] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "fallback">("loading");

  useEffect(() => {
    const handleDocumentReady = () => setDocumentVersion((version) => version + 1);
    window.addEventListener(READER_PDF_DOCUMENT_EVENT, handleDocumentReady);
    return () => window.removeEventListener(READER_PDF_DOCUMENT_EVENT, handleDocumentReady);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || !props.visible) return;
    const document = readerPdfDocument(props.book);
    if (document === undefined) {
      setStatus("fallback");
      return;
    }
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<unknown> } | undefined;
    let page: { cleanup: () => void } | undefined;
    setStatus("loading");
    const render = async () => {
      try {
        const loadedPage = await document.getPage(props.pageNumber);
        page = loadedPage;
        if (cancelled) return;
        const baseViewport = loadedPage.getViewport({ scale: 1 });
        const deviceScale = Math.min(window.devicePixelRatio || 1, 2);
        const cssScale = Math.min(68 / baseViewport.width, 86 / baseViewport.height);
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
      } catch {
        if (!cancelled) setStatus("fallback");
      } finally {
        page?.cleanup();
      }
    };
    void render();
    return () => {
      cancelled = true;
      renderTask?.cancel();
      page?.cleanup();
      canvas.width = 0;
      canvas.height = 0;
    };
  }, [documentVersion, props.book, props.pageNumber, props.visible]);

  return (
    <>
      <canvas
        ref={canvasRef}
        className={`reader-progress-pdf-thumbnail is-${status}`}
        aria-hidden="true"
      />
      {status !== "ready" && (
        <span className="reader-progress-preview-page-number">{props.pageNumber}</span>
      )}
    </>
  );
}
