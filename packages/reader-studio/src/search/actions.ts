import { type SearchHit } from "@bcr/reader-core";
import { type ReaderState, type ReaderSearchReveal } from "../state/model";
import type { ReaderStatePort } from "../state/port";

export function createReaderSearchActions(port: ReaderStatePort) {
  const { getSnapshot, update } = port;
  let searchRevealSequence = 0;

  function setSearchScope(searchScope: ReaderState["searchScope"]): void {
    update({
      searchScope,
      searchHits: [],
      searchActiveIndex: -1,
      searchBusy: true,
      searchError: null,
      searchTruncated: false,
    });
  }

  function setSearch(query: string, hits: ReadonlyArray<SearchHit>, bookId: string | null): void {
    const previous =
      getSnapshot().query === query
        ? getSnapshot().searchHits[getSnapshot().searchActiveIndex]
        : undefined;
    const selected =
      previous === undefined
        ? -1
        : hits.findIndex(
            (hit) =>
              hit.bookId === previous.bookId &&
              hit.sectionId === previous.sectionId &&
              hit.matchStart === previous.matchStart,
          );
    update({
      query,
      searchHits: hits,
      searchBookId: bookId,
      searchActiveIndex: selected >= 0 ? selected : hits.length > 0 ? 0 : -1,
      searchBusy: false,
      searchReveal: null,
      searchError: null,
      ...(getSnapshot().query !== query ? { searchTruncated: false } : {}),
    });
  }

  function setSearchBusy(searchBusy: boolean): void {
    update({ searchBusy, ...(searchBusy ? { searchError: null } : {}) });
  }

  function setSearchError(searchError: string | null): void {
    update({ searchError, searchBusy: false });
  }

  function retrySearch(): void {
    update({ searchError: null, searchRevision: getSnapshot().searchRevision + 1 });
  }

  function setSearchTruncated(searchTruncated: boolean): void {
    update({ searchTruncated });
  }

  function setSourceError(bookId: string, message: string | null): void {
    const errors = { ...getSnapshot().sourceErrorsByBook };
    if (message === null) delete errors[bookId];
    else errors[bookId] = message;
    update({ sourceErrorsByBook: errors });
  }

  function moveSearch(delta: number): void {
    const count = getSnapshot().searchHits.length;
    if (count === 0) return;
    const current = getSnapshot().searchActiveIndex < 0 ? 0 : getSnapshot().searchActiveIndex;
    const next = (current + delta + count) % count;
    update({ searchActiveIndex: next });
  }

  function setSearchActiveIndex(searchActiveIndex: number): void {
    if (getSnapshot().searchHits.length === 0) return;
    update({
      searchActiveIndex: Math.min(
        getSnapshot().searchHits.length - 1,
        Math.max(0, searchActiveIndex),
      ),
    });
  }

  function revealSearchHit(hit: SearchHit): void {
    const reveal: ReaderSearchReveal = {
      id: ++searchRevealSequence,
      bookId: hit.bookId,
      sectionId: hit.sectionId,
      matchStart: Math.max(0, hit.matchStart),
      matchLength: Math.max(0, hit.matchLength),
    };
    update({ searchReveal: reveal });
  }

  function clearSearchReveal(id: number): void {
    if (getSnapshot().searchReveal?.id !== id) return;
    update({ searchReveal: null });
  }

  return {
    setSearchScope,
    setSearch,
    setSearchBusy,
    setSearchError,
    retrySearch,
    setSearchTruncated,
    setSourceError,
    moveSearch,
    setSearchActiveIndex,
    revealSearchHit,
    clearSearchReveal,
  };
}
