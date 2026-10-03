import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useState } from "react";
import { openSearchHit } from "../search/readerSearchNavigation";
import { reader } from "../state/store";
import { useReader } from "../state/useReader";

/** Search replaces the mobile reading controls instead of adding a second row. */
export function ReaderSearchBar() {
  const query = useReader((state) => state.query);
  const hits = useReader((state) => state.searchHits);
  const index = useReader((state) => state.searchActiveIndex);
  const truncated = useReader((state) => state.searchTruncated);
  const searching = useReader((state) => state.searchBusy);
  const [moving, setMoving] = useState(false);
  const move = async (delta: number) => {
    if (moving || !hits.length) return;
    const next = (Math.max(0, index) + delta + hits.length) % hits.length;
    setMoving(true);
    try {
      await openSearchHit(hits[next]!, next);
    } finally {
      setMoving(false);
    }
  };
  return (
    <>
      <button
        type="button"
        className="reader-mobile-nav-step"
        aria-label="退出搜索导航"
        onClick={() => {
          reader.setSearch("", [], null);
          requestAnimationFrame(() =>
            document
              .querySelector<HTMLElement>('.reader-mobile-nav [aria-label="调整阅读进度"]')
              ?.focus({ preventScroll: true }),
          );
        }}
      >
        <X className="reader-icon" />
        <span>退出</span>
      </button>
      <button
        type="button"
        className="reader-search-position"
        aria-label="打开搜索结果"
        onClick={() => reader.setSearchOpen(true)}
      >
        <span className="reader-search-term">{query}</span>
        <span className="reader-search-count" aria-live="polite" aria-atomic="true">
          {searching
            ? "搜索中…"
            : hits.length
              ? `${Math.max(0, index) + 1} / ${hits.length}${truncated ? "+" : ""} 处`
              : "没有匹配结果"}
        </span>
      </button>
      <button
        type="button"
        className="reader-mobile-nav-step"
        aria-label="上一个命中"
        disabled={searching || moving || !hits.length}
        onClick={() => void move(-1)}
      >
        <ChevronLeft className="reader-icon" />
        <span>上处</span>
      </button>
      <button
        type="button"
        className="reader-mobile-nav-step"
        aria-label="下一个命中"
        disabled={searching || moving || !hits.length}
        onClick={() => void move(1)}
      >
        <ChevronRight className="reader-icon" />
        <span>下处</span>
      </button>
    </>
  );
}
