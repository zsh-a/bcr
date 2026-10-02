import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, Search, History, X } from "lucide-react";
import { useState } from "react";
import { ReaderSheet } from "../workbench/ReaderSheet";
import { reader } from "../state/store";
import { useReader } from "../state/useReader";
import { openSearchHit } from "../search/readerSearchNavigation";
import { percentageForLocator } from "@bcr/reader-core";

export function ReaderHistoryBar() {
  const [open, setOpen] = useState(false);
  const history = useReader((state) => state.navigationHistory);
  const hits = useReader((state) => state.searchHits);
  const query = useReader((state) => state.query);
  const index = useReader((state) => state.searchActiveIndex);
  const library = useReader((state) => state.library);
  const truncated = useReader((state) => state.searchTruncated);
  const back = history.back.filter((entry) => library.some((book) => book.id === entry.bookId));
  const forward = history.forward.filter((entry) =>
    library.some((book) => book.id === entry.bookId),
  );
  const target = back.at(-1);
  const book = library.find((entry) => entry.id === target?.bookId);
  const move = (delta: number) => {
    const next = (index + delta + hits.length) % hits.length;
    const hit = hits[next];
    if (hit !== undefined) void openSearchHit(hit, next);
  };
  return (
    <nav
      className={`reader-history-bar ${back.length === 0 && forward.length === 0 && !query ? "is-empty" : ""}`}
      aria-label="跳转历史与搜索导航"
    >
      <div className="reader-history-controls">
        <button
          type="button"
          disabled={!back.length}
          aria-label="返回原处"
          onClick={() => reader.navigateHistory("back")}
          title={
            book === undefined
              ? "返回跳转前位置"
              : `返回 ${book.title} · ${book.sections.find((section) => section.id === target?.locator.sectionId)?.label ?? ""}`
          }
        >
          <ArrowLeft className="reader-icon" />
          <span>返回</span>
        </button>
        <button
          type="button"
          disabled={!forward.length}
          onClick={() => reader.navigateHistory("forward")}
          aria-label="前进到跳转位置"
        >
          <ArrowRight className="reader-icon" />
        </button>
        <button type="button" aria-label="查看跳转历史" onClick={() => setOpen(true)}>
          <History className="reader-icon" />
        </button>
      </div>
      {query && (
        <div className="reader-history-controls">
          <button
            type="button"
            onClick={() => reader.setSearchOpen(true)}
            aria-label="打开搜索结果"
          >
            <Search className="reader-icon" />
            <span>
              {hits.length ? `${index + 1} / ${hits.length}${truncated ? "+" : ""}` : "搜索"}
            </span>
          </button>
          <button
            type="button"
            disabled={!hits.length}
            onClick={() => move(-1)}
            aria-label="上一个命中"
          >
            <ChevronLeft className="reader-icon" />
          </button>
          <button
            type="button"
            disabled={!hits.length}
            onClick={() => move(1)}
            aria-label="下一个命中"
          >
            <ChevronRight className="reader-icon" />
          </button>
        </div>
      )}
      <ReaderSheet open={open} labelId="reader-history-title" onClose={() => setOpen(false)}>
        <section className="reader-mobile-sheet reader-data-sheet">
          <header className="reader-data-heading">
            <div>
              <span className="ui-section-label">READING TRAIL</span>
              <h2 id="reader-history-title">跳转历史</h2>
            </div>
            <button
              type="button"
              className="ui-btn ui-icon-btn ui-btn-ghost ui-btn-lg"
              aria-label="关闭跳转历史"
              onClick={() => setOpen(false)}
            >
              <X className="reader-icon" />
            </button>
          </header>
          <p>保留最近 50 个跳转位置，刷新后仍可返回。连续滚动和正常分页不会留下记录。</p>
          {back.length === 0 && <p>还没有可返回的位置。</p>}
          <div className="reader-history-list">
            {[...back].reverse().map((entry, ordinal) => {
              const publication = library.find((item) => item.id === entry.bookId);
              return (
                <button
                  type="button"
                  key={`${entry.bookId}-${ordinal}`}
                  onClick={() => {
                    reader.navigateHistory("back", ordinal + 1);
                    setOpen(false);
                  }}
                >
                  <span>
                    <strong>{publication?.title}</strong>
                    <small>
                      {
                        publication?.sections.find(
                          (section) => section.id === entry.locator.sectionId,
                        )?.label
                      }{" "}
                      · 全书{" "}
                      {Math.round(
                        (publication ? percentageForLocator(publication, entry.locator) : 0) * 100,
                      )}
                      %
                    </small>
                  </span>
                  <ArrowLeft className="reader-icon" />
                </button>
              );
            })}
          </div>
        </section>
      </ReaderSheet>
    </nav>
  );
}
