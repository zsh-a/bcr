import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReaderBook } from "@bcr/reader-core";
import { PdfProgressThumbnail } from "./ReaderProgressScrubber";

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
  const end = Math.min(book.sections.length, start + PAGE_GROUP);
  return (
    <div className="reader-pdf-browser">
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
          前往页面
          <input
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
              setError("");
            }}
            aria-label="PDF 页面标签或页序"
            placeholder="页码或标签"
            required
          />
        </label>
        <button type="submit" className="ui-btn ui-btn-lg ui-btn-default">
          跳转
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      <div className="reader-pdf-browser-range">
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
      </div>
      <div key={start} className="reader-pdf-thumbnail-grid" aria-label="PDF 页面缩略图">
        {book.sections.slice(start, end).map((section, index) => (
          <button
            key={section.id}
            type="button"
            aria-label={`前往 PDF 第 ${start + index + 1} 页：${section.label}`}
            aria-current={section.id === activeSectionId ? "page" : undefined}
            onClick={() => onNavigate(section.id)}
          >
            <span className="reader-pdf-thumbnail-paper">
              <PdfProgressThumbnail
                book={book}
                pageNumber={start + index + 1}
                visible
                width={110}
                height={150}
              />
            </span>
            <strong>{section.label}</strong>
            <small>第 {start + index + 1} 页</small>
          </button>
        ))}
      </div>
    </div>
  );
}
