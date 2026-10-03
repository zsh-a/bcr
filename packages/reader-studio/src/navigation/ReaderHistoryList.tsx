import { percentageForLocator } from "@bcr/reader-core";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { reader } from "../state/store";
import { useReader } from "../state/useReader";

export function useReaderHistory() {
  const history = useReader((state) => state.navigationHistory);
  const library = useReader((state) => state.library);
  return {
    library,
    back: history.back.filter((entry) => library.some((book) => book.id === entry.bookId)),
    forward: history.forward.filter((entry) => library.some((book) => book.id === entry.bookId)),
  };
}

export function ReaderHistoryList(props: { onNavigate: () => void; showForward?: boolean }) {
  const { back, forward, library } = useReaderHistory();
  return (
    <>
      <p className="reader-history-description">
        保留最近 50 个跳转位置。连续滚动和正常翻页不计入历史。
      </p>
      {props.showForward && forward.length > 0 && (
        <button
          type="button"
          className="reader-progress-action"
          onClick={() => {
            props.onNavigate();
            reader.navigateHistory("forward");
          }}
        >
          <ArrowRight className="reader-icon" />
          前进到跳转位置
        </button>
      )}
      {back.length === 0 && <p className="reader-history-description">还没有可返回的位置。</p>}
      <div className="reader-history-list">
        {[...back].reverse().map((entry, ordinal) => {
          const publication = library.find((book) => book.id === entry.bookId)!;
          return (
            <button
              type="button"
              key={`${entry.bookId}-${ordinal}`}
              onClick={() => {
                props.onNavigate();
                reader.navigateHistory("back", ordinal + 1);
              }}
            >
              <span>
                <strong>{publication.title}</strong>
                <small>
                  {
                    publication.sections.find((section) => section.id === entry.locator.sectionId)
                      ?.label
                  }{" "}
                  · 全书 {Math.round(percentageForLocator(publication, entry.locator) * 100)}%
                </small>
              </span>
              <ArrowLeft className="reader-icon" />
            </button>
          );
        })}
      </div>
    </>
  );
}
