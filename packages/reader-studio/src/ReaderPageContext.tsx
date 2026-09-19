import { useEffect, useState } from "react";
import type { ReaderBook } from "@bcr/reader-core";
import { currentTxtChapter } from "./txtChapters";
import { percent } from "./readerPresentation";
import { useReader } from "./store";

/** Quiet context occupies the same reserved space as the optional controls. */
export function ReaderPageContext({
  book,
  onShowTools,
}: {
  book: ReaderBook;
  onShowTools: () => void;
}) {
  const activeId = useReader((state) => state.activeSectionId);
  const progress = useReader((state) => state.progressByBook[book.id]?.percentage ?? 0);
  const chapter = currentTxtChapter(book, activeId);
  const section = book.sections.find((section) => section.id === activeId);
  const title =
    chapter?.label ?? (book.source.format === "txt" ? book.title : (section?.label ?? book.title));
  const [time, setTime] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return (
    <>
      <button
        type="button"
        className="reader-quiet-heading"
        onClick={onShowTools}
        aria-label="显示阅读工具栏"
        title={title}
      >
        <span>{title}</span>
      </button>
      <div className="reader-quiet-status" aria-label="阅读状态">
        <span>
          {percent(progress)} <span className="reader-quiet-status-label">全书</span>
        </span>
        <time dateTime={time.toISOString()}>
          {time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}
        </time>
      </div>
    </>
  );
}
