import {
  firstLocator,
  normalizeLocator,
  progressForLocator,
  sameLocator,
  type ReaderLocator,
} from "@bcr/reader-core";
import {
  activeBook,
  type ReaderState,
  type ReaderSearchSession,
  type ReaderHistoryEntry,
} from "../state/model";
import type { ReaderStatePort } from "../state/port";

export function createReaderNavigationActions(port: ReaderStatePort) {
  const { getSnapshot, update } = port;

  function openBook(bookId: string, sectionId?: string, remember = true): void {
    const book = getSnapshot().library.find((candidate) => candidate.id === bookId);
    if (book === undefined) return;
    if (remember) rememberPosition();
    const stored = getSnapshot().progressByBook[book.id];
    const locator =
      sectionId === undefined
        ? (stored?.locator ?? firstLocator(book))
        : normalizeLocator(book, {
            kind: "section",
            sectionId,
            progression: 0,
          });
    const progress = progressForLocator(book, locator);
    update({
      activeBookId: book.id,
      activeSectionId: progress.locator.sectionId,
      navigationSequence: getSnapshot().navigationSequence + 1,
      progressByBook: { ...getSnapshot().progressByBook, [book.id]: progress },
      query: "",
      searchHits: [],
      searchBookId: null,
      searchActiveIndex: -1,
      searchReveal: null,
      searchOpen: false,
    });
  }

  function openBookmark(bookId: string, bookmarkId: string): void {
    const book = getSnapshot().library.find((candidate) => candidate.id === bookId);
    const bookmark = getSnapshot().bookmarksByBook[bookId]?.find(
      (candidate) => candidate.id === bookmarkId,
    );
    if (book === undefined || bookmark === undefined) return;
    rememberPosition();
    const progress = progressForLocator(book, bookmark.locator);
    update({
      activeBookId: book.id,
      activeSectionId: progress.locator.sectionId,
      navigationSequence: getSnapshot().navigationSequence + 1,
      progressByBook: { ...getSnapshot().progressByBook, [book.id]: progress },
      query: "",
      searchHits: [],
      searchBookId: null,
      searchActiveIndex: -1,
      searchReveal: null,
      searchOpen: false,
    });
  }

  function openAnnotation(bookId: string, annotationId: string): void {
    const book = getSnapshot().library.find((candidate) => candidate.id === bookId);
    const annotation = getSnapshot().annotationsByBook[bookId]?.find(
      (candidate) => candidate.id === annotationId,
    );
    if (book === undefined || annotation === undefined) return;
    rememberPosition();
    const progress = progressForLocator(book, annotation.locator);
    update({
      activeBookId: book.id,
      activeSectionId: progress.locator.sectionId,
      navigationSequence: getSnapshot().navigationSequence + 1,
      progressByBook: { ...getSnapshot().progressByBook, [book.id]: progress },
      query: "",
      searchHits: [],
      searchBookId: null,
      searchActiveIndex: -1,
      searchReveal: null,
      searchOpen: false,
    });
  }

  function setLocator(locator: ReaderLocator, percentage?: number): void {
    const book = activeBook(getSnapshot());
    if (book === undefined) return;
    const progress = progressForLocator(book, locator);
    const nextProgress = percentage === undefined ? progress : { ...progress, percentage };
    const currentProgress = getSnapshot().progressByBook[book.id];
    const currentAnchorStart = currentProgress?.locator.textAnchor?.start;
    const nextAnchorStart = nextProgress.locator.textAnchor?.start;
    const bothTextAnchored = currentAnchorStart !== undefined && nextAnchorStart !== undefined;
    const currentImage = currentProgress?.locator.imageAnchor;
    const nextImage = nextProgress.locator.imageAnchor;
    const currentPage = currentProgress?.locator.pageAnchor;
    const nextPage = nextProgress.locator.pageAnchor;
    const sameLocalPosition =
      currentPage || nextPage
        ? Boolean(
            currentPage &&
            nextPage &&
            Math.abs(currentPage.x - nextPage.x) < 0.00001 &&
            Math.abs(currentPage.y - nextPage.y) < 0.00001,
          )
        : currentImage !== undefined || nextImage !== undefined
          ? currentImage !== undefined &&
            nextImage !== undefined &&
            currentImage.index === nextImage.index &&
            Math.abs(currentImage.x - nextImage.x) < 0.00001 &&
            Math.abs(currentImage.y - nextImage.y) < 0.00001
          : bothTextAnchored
            ? Math.abs(currentAnchorStart - nextAnchorStart) < 16
            : currentProgress !== undefined &&
              currentProgress.locator.textAnchor === undefined &&
              nextProgress.locator.textAnchor === undefined &&
              Math.abs(currentProgress.locator.progression - nextProgress.locator.progression) <
                0.001;
    if (
      currentProgress !== undefined &&
      currentProgress.locator.sectionId === nextProgress.locator.sectionId &&
      sameLocalPosition
    ) {
      return;
    }
    update({
      activeSectionId: nextProgress.locator.sectionId,
      progressByBook: {
        ...getSnapshot().progressByBook,
        [book.id]: nextProgress,
      },
    });
  }

  function seekLocator(locator: ReaderLocator, percentage?: number, remember = false): void {
    const book = activeBook(getSnapshot());
    if (book === undefined) return;
    if (remember) rememberPosition();
    const progress = progressForLocator(book, locator);
    const nextProgress =
      percentage === undefined
        ? progress
        : { ...progress, percentage: Math.min(1, Math.max(0, percentage)) };
    update({
      activeSectionId: nextProgress.locator.sectionId,
      navigationSequence: getSnapshot().navigationSequence + 1,
      seekSequence: getSnapshot().seekSequence + 1,
      progressByBook: {
        ...getSnapshot().progressByBook,
        [book.id]: nextProgress,
      },
    });
  }

  function currentPosition(): ReaderHistoryEntry | undefined {
    if (typeof window !== "undefined")
      window.dispatchEvent(new Event("bcr-reader-capture-progress"));
    const bookId = getSnapshot().activeBookId;
    const locator = bookId === null ? undefined : getSnapshot().progressByBook[bookId]?.locator;
    return bookId === null || locator === undefined ? undefined : { bookId, locator };
  }

  function rememberPosition(): void {
    const entry = currentPosition();
    if (entry === undefined) return;
    const back = getSnapshot().navigationHistory.back;
    const last = back.at(-1);
    if (
      typeof window !== "undefined" &&
      !(last?.bookId === entry.bookId && sameLocator(last.locator, entry.locator))
    )
      window.dispatchEvent(new CustomEvent("bcr-reader-remember-position", { detail: entry }));
    update({
      navigationHistory: {
        back:
          last?.bookId === entry.bookId && sameLocator(last.locator, entry.locator)
            ? back
            : [...back, entry].slice(-50),
        forward: [],
      },
    });
  }

  function navigateHistory(direction: "back" | "forward", distance = 1, fromBrowser = false): void {
    const current = currentPosition();
    const history = getSnapshot().navigationHistory;
    const entries = history[direction].filter((entry) =>
      getSnapshot().library.some((book) => book.id === entry.bookId),
    );
    const count = Math.max(1, Math.min(entries.length, Math.floor(distance)));
    const target = entries.at(-count);
    const book = getSnapshot().library.find((item) => item.id === target?.bookId);
    if (target === undefined || book === undefined) return;
    if (!fromBrowser && typeof window !== "undefined") {
      const detail = { direction, distance: count, handled: false };
      window.dispatchEvent(new CustomEvent("bcr-reader-history-request", { detail }));
      if (detail.handled) return;
    }
    const other = direction === "back" ? "forward" : "back";
    const progress = progressForLocator(book, target.locator);
    update({
      navigationHistory: {
        ...history,
        [direction]: entries.slice(0, -count),
        [other]: [
          ...history[other],
          ...(current === undefined ? [] : [current]),
          ...entries.slice(entries.length - count + 1).reverse(),
        ].slice(-50),
      },
      activeBookId: book.id,
      activeSectionId: progress.locator.sectionId,
      progressByBook: { ...getSnapshot().progressByBook, [book.id]: progress },
      navigationSequence: getSnapshot().navigationSequence + 1,
      searchReveal: null,
      searchBookId: null,
      searchOpen: false,
    });
  }

  function restoreReadingHistory(
    history: ReaderState["navigationHistory"],
    search?: ReaderSearchSession,
  ): void {
    update({
      navigationHistory: history,
      ...(search
        ? {
            query: search.query,
            searchBookId: search.searchBookId,
            searchScope: search.scope ?? "library",
            searchOpen: false,
          }
        : {}),
    });
  }

  return {
    openBook,
    openBookmark,
    openAnnotation,
    setLocator,
    seekLocator,
    currentPosition,
    rememberPosition,
    navigateHistory,
    restoreReadingHistory,
  };
}
