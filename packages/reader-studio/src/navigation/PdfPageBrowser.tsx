import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, LocateFixed } from "lucide-react";
import type { ReaderBook } from "@bcr/reader-core";
import { PdfProgressThumbnail } from "./ReaderProgressScrubber";
import { useReader } from "../state/useReader";

const PAGE_GROUP = 18;
export function PdfPageBrowser({
  book,
  activeSectionId,
  onNavigate,
}: {
  book: ReaderBook;
  activeSectionId: string | null;
  onNavigate: (id: string) => void;
}) {
  const activeIndex = Math.max(
    0,
    book.sections.findIndex((s) => s.id === activeSectionId),
  );
  const [start, setStart] = useState(Math.floor(activeIndex / PAGE_GROUP) * PAGE_GROUP);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const errorId = useId();
  const gridRef = useRef<HTMLDivElement>(null);
  const color = useReader(
    (state) =>
      state.settings.books?.[book.id]?.pdfColor ??
      (state.settings.theme === "night" ? "night" : "original"),
  );
  const currentGroup = Math.floor(activeIndex / PAGE_GROUP) * PAGE_GROUP;
  useEffect(() => setStart(currentGroup), [book.id, currentGroup]);
  const revealCurrent = () => {
    gridRef.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ block: "nearest", behavior: "instant" });
  };
  useEffect(() => {
    // Wait for the parent dialog to enter the top layer before measuring.
    const frame = requestAnimationFrame(revealCurrent);
    return () => cancelAnimationFrame(frame);
  }, [activeIndex, start]);
  const end = Math.min(book.sections.length, start + PAGE_GROUP);
  return (
    <div className={`reader-pdf-browser reader-pdf-color-${color}`}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const value = input.trim();
          const numeric = /^\d+$/.test(value) ? Number(value) : NaN;
          const section =
            book.sections.find((s) => s.label === value) ??
            (Number.isInteger(numeric) ? book.sections[numeric - 1] : undefined);
          if (!section) {
            setError("请输入有效页码或页面标签");
            return;
          }
          onNavigate(section.id);
        }}
      >
        <label>
          <span>跳至</span>
          <input
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
              setError("");
            }}
            aria-label="PDF 页面标签或页序"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            placeholder="页码或标签"
            enterKeyHint="go"
            autoComplete="off"
            required
          />
        </label>
        <button type="submit" className="ui-btn ui-btn-lg ui-btn-default">
          跳转
        </button>
      </form>
      {error && (
        <p id={errorId} role="alert">
          {error}
        </p>
      )}
      <div
        ref={gridRef}
        key={start}
        className="reader-pdf-thumbnail-grid"
        aria-label="PDF 页面缩略图"
      >
        {book.sections.slice(start, end).map((section, index) => {
          const number = start + index + 1;
          const labelled = section.label !== `第 ${number} 页` && section.label !== String(number);
          return (
            <button
              key={section.id}
              type="button"
              aria-label={`前往 PDF 第 ${number} 页：${section.label}`}
              aria-current={section.id === activeSectionId ? "page" : undefined}
              onClick={() => onNavigate(section.id)}
            >
              <span className="reader-pdf-thumbnail-paper">
                <PdfProgressThumbnail
                  book={book}
                  pageNumber={number}
                  visible
                  width={180}
                  height={220}
                />
                {section.id === activeSectionId && (
                  <span className="reader-pdf-thumbnail-current" aria-hidden="true">
                    <Check size={12} />
                  </span>
                )}
              </span>
              <span className="reader-pdf-thumbnail-caption">
                <strong>{labelled ? section.label : number}</strong>
                {labelled && <small>第 {number} 页</small>}
              </span>
            </button>
          );
        })}
      </div>
      <div className="reader-pdf-browser-range">
        <button
          type="button"
          className="reader-pdf-browser-current"
          aria-label="定位当前 PDF 页面"
          title="定位当前页缩略图"
          onClick={() => {
            setStart(currentGroup);
            revealCurrent();
          }}
        >
          <LocateFixed size={16} aria-hidden="true" />
          <span>当前页</span>
        </button>
        <span className="reader-pdf-browser-pagination">
          <button
            type="button"
            aria-label="上一组 PDF 页面"
            disabled={start === 0}
            onClick={() => setStart(Math.max(0, start - PAGE_GROUP))}
          >
            <ChevronLeft size={18} />
          </button>
          <span aria-live="polite">
            {start + 1}–{end} / {book.sections.length} 页
          </span>
          <button
            type="button"
            aria-label="下一组 PDF 页面"
            disabled={end === book.sections.length}
            onClick={() => setStart(end)}
          >
            <ChevronRight size={18} />
          </button>
        </span>
      </div>
    </div>
  );
}
