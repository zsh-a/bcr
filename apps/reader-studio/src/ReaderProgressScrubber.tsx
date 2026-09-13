import {
  createLocator,
  locatorAtPercentage,
  percentageForLocator,
  type ReaderBook,
  type ReaderLocator,
} from "@bcr/reader-core";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { currentTxtChapter } from "./txtChapters";
import { READER_PDF_DOCUMENT_EVENT, readerPdfDocument } from "./readerPdfAdapter";
import { clamp, percent } from "./readerPresentation";
import { reader, useReader } from "./store";
import { READER_CAPTURE_PROGRESS_EVENT } from "./useReaderRuntime";

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

interface ReaderProgressMarker {
  readonly id: string;
  readonly label: string;
  readonly percentage: number;
}

interface PdfThumbnailCacheEntry {
  readonly image: ImageData;
  readonly cssWidth: number;
  readonly cssHeight: number;
}

const pdfThumbnailCache = new WeakMap<ReaderBook, Map<string, PdfThumbnailCacheEntry>>();

function pdfThumbnailCacheFor(book: ReaderBook): Map<string, PdfThumbnailCacheEntry> {
  const cached = pdfThumbnailCache.get(book);
  if (cached !== undefined) return cached;
  const next = new Map<string, PdfThumbnailCacheEntry>();
  pdfThumbnailCache.set(book, next);
  return next;
}

function paintPdfThumbnail(canvas: HTMLCanvasElement, entry: PdfThumbnailCacheEntry): void {
  canvas.width = entry.image.width;
  canvas.height = entry.image.height;
  canvas.style.width = `${entry.cssWidth}px`;
  canvas.style.height = `${entry.cssHeight}px`;
  canvas.getContext("2d")?.putImageData(entry.image, 0, 0);
}

function rememberPdfThumbnail(book: ReaderBook, key: string, entry: PdfThumbnailCacheEntry): void {
  const cached = pdfThumbnailCacheFor(book);
  cached.delete(key);
  cached.set(key, entry);
  while (cached.size > 24) cached.delete(cached.keys().next().value!);
}

function progressMarkers(book: ReaderBook): readonly ReaderProgressMarker[] {
  const sections = new Map(book.sections.map((section) => [section.id, section] as const));
  const positions = new Set<string>();
  const markers: ReaderProgressMarker[] = [];
  const visit = (items: NonNullable<ReaderBook["toc"]>) => {
    for (const item of items) {
      const section = sections.get(item.sectionId ?? "");
      if (section !== undefined && !positions.has(section.id)) {
        positions.add(section.id);
        markers.push({
          id: item.id,
          label: item.label,
          percentage: percentageForLocator(book, createLocator(section)),
        });
      }
      if (item.children?.length) visit(item.children);
    }
  };
  visit(book.toc ?? []);
  markers.sort((left, right) => left.percentage - right.percentage);
  if (markers.length <= 24) return markers;
  const stride = Math.ceil(markers.length / 24);
  return markers.filter(
    (_marker, index) => index === 0 || index === markers.length - 1 || index % stride === 0,
  );
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
  };

  const chapter = currentTxtChapter(props.book, activeSectionId);
  const section = props.book.sections.find((item) => item.id === activeSectionId);
  const context = chapter?.label ?? section?.label ?? "全书进度";
  const previewLocator = locatorAtPercentage(props.book, clamp(draft, 0, 1));
  const previewSection = props.book.sections.find((item) => item.id === previewLocator.sectionId);
  const previewChapter = currentTxtChapter(props.book, previewSection?.id ?? null);
  const previewContext = previewChapter?.label ?? previewSection?.label ?? context;
  const markers = useMemo(() => progressMarkers(props.book), [props.book]);
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
        <span className="reader-progress-dock-label">阅读进度</span>
        <strong title={dragging ? previewContext : context}>
          {dragging ? previewContext : context}
        </strong>
        <output htmlFor="reader-progress-range">{percent(draft)}</output>
      </div>
      <div className="reader-progress-range">
        <div className="reader-progress-markers" aria-hidden="true">
          {markers.map((marker) => (
            <span
              key={marker.id}
              className="reader-progress-marker"
              style={{ left: `${marker.percentage * 100}%` }}
              title={marker.label}
            />
          ))}
        </div>
        <input
          id="reader-progress-range"
          type="range"
          min="0"
          max="100"
          step="0.1"
          value={draft * 100}
          aria-label="调整进度"
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
            const next = clamp(Number(event.target.value) / 100, 0, 1);
            draftRef.current = next;
            setDraft(next);
          }}
          onKeyDown={(event) => {
            if (
              ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)
            )
              setDragging(true);
          }}
          onKeyUp={commit}
          onBlur={commit}
        />
      </div>
    </section>
  );
}

function previewSnippet(section: ReaderBook["sections"][number] | undefined): string {
  if (section === undefined) return "拖动定位";
  const text = section.text.replace(/\s+/gu, " ").trim();
  return text.slice(0, 86) || section.label || "当前位置";
}

function previewLines(section: ReaderBook["sections"][number] | undefined): string[] {
  return previewSnippet(section).match(/.{1,14}/gu)?.slice(0, 4) ?? [];
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
            {previewLines(props.section).map((line, index) => (
              <i key={`${index}:${line}`}>{line}</i>
            ))}
          </div>
        )}
      </div>
      <div className="reader-progress-preview-copy">
        <span>
          {isPdf
            ? `第 ${pageNumber} / ${props.book.sections.length} 页`
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
    const deviceScale = Math.min(window.devicePixelRatio || 1, 2);
    const cacheKey = `${props.pageNumber}:${deviceScale}`;
    const cached = pdfThumbnailCacheFor(props.book).get(cacheKey);
    if (cached !== undefined) {
      paintPdfThumbnail(canvas, cached);
      setStatus("ready");
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
        if (cancelled) return;
        rememberPdfThumbnail(props.book, cacheKey, {
          image: context.getImageData(0, 0, canvas.width, canvas.height),
          cssWidth: Math.ceil(viewport.width / deviceScale),
          cssHeight: Math.ceil(viewport.height / deviceScale),
        });
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("fallback");
      } finally {
        page?.cleanup();
      }
    };
    const frame = window.requestAnimationFrame(() => void render());
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
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
