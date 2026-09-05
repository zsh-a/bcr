import { useSyncExternalStore } from "react";
import {
  firstLocator,
  normalizeLocator,
  progressForLocator,
  sameLocator,
  type ReaderAnnotation,
  type ReaderBook,
  type ReaderBookmark,
  type ReaderLocator,
  type ReaderProgress,
  type SearchHit,
} from "@bcr/reader-core";
import {
  activeBook,
  createDemoBook,
  DEFAULT_READER_SETTINGS,
  type ReaderSettings,
  type ReaderState,
  type ReaderSearchSession,
  type ReaderSearchReveal,
  type ReaderHistoryEntry,
} from "./model";

const demo = createDemoBook();

function releaseBookResources(book: ReaderBook): void {
  const embedded = new Set(
    book.sections.flatMap((section) => section.html?.match(/blob:[^\s"'<>]+/gu) ?? []),
  );
  for (const url of embedded) URL.revokeObjectURL(url);
  if (book.source.objectUrl !== undefined) URL.revokeObjectURL(book.source.objectUrl);
  if (book.coverUrl !== undefined) URL.revokeObjectURL(book.coverUrl);
  for (const section of book.sections) {
    if (section.imageUrl !== undefined && section.imageUrl !== book.coverUrl) {
      URL.revokeObjectURL(section.imageUrl);
    }
  }
}

function initialState(): ReaderState {
  const progress = progressForLocator(demo, firstLocator(demo), Date.now());
  return {
    navigationHistory: { back: [], forward: [] },
    searchScope: "library",
    status: "booting",
    error: null,
    library: [demo],
    activeBookId: demo.id,
    activeSectionId: demo.sections[0]?.id ?? null,
    navigationSequence: 0,
    progressByBook: { [demo.id]: progress },
    bookmarksByBook: { [demo.id]: [] },
    annotationsByBook: { [demo.id]: [] },
    query: "",
    searchHits: [],
    searchBookId: null,
    searchActiveIndex: -1,
    searchBusy: false,
    searchReveal: null,
    settings: DEFAULT_READER_SETTINGS,
    sidebarOpen: true,
    searchOpen: false,
    lastSavedAt: null,
    saveError: null,
  };
}

class ReaderStore {
  private state: ReaderState = initialState();
  private readonly listeners = new Set<() => void>();
  private searchRevealSequence = 0;

  getSnapshot = (): ReaderState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(partial: Partial<ReaderState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) listener();
  }

  setReady(): void {
    this.set({ status: "ready", error: null });
  }

  setError(error: unknown): void {
    this.set({
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  hydrate(
    library: ReadonlyArray<ReaderBook>,
    progressByBook: Readonly<Record<string, ReaderProgress>>,
    settings: ReaderSettings,
    bookmarksByBook: Readonly<Record<string, ReadonlyArray<ReaderBookmark>>> = {},
    activeBookId?: string | null,
    annotationsByBook: Readonly<Record<string, ReadonlyArray<ReaderAnnotation>>> = {},
    searchSession?: ReaderSearchSession,
    navigationHistory: ReaderState["navigationHistory"] = { back: [], forward: [] },
  ): void {
    const nextLibrary = library.length > 0 ? library : [demo];
    const first = nextLibrary[0] ?? demo;
    const requestedBookId = activeBookId ?? this.state.activeBookId;
    const current =
      requestedBookId !== null
        ? nextLibrary.find((book) => book.id === requestedBookId)
        : undefined;
    const active = current ?? first;
    const progress = progressByBook[active.id] ?? progressForLocator(active, firstLocator(active));
    this.set({
      navigationHistory,
      searchScope: searchSession?.scope ?? "library",
      library: nextLibrary,
      activeBookId: active.id,
      activeSectionId: progress.locator.sectionId,
      progressByBook,
      bookmarksByBook,
      annotationsByBook,
      query: searchSession?.query ?? "",
      searchBookId: searchSession?.searchBookId ?? null,
      searchOpen: searchSession?.searchOpen ?? false,
      searchHits: [],
      searchActiveIndex: -1,
      searchReveal: null,
      settings,
      status: "ready",
      error: null,
    });
  }

  /** Merge books recovered from the durable catalog without resetting live reading state. */
  reconcileLibrary(
    library: ReadonlyArray<ReaderBook>,
    progressByBook: Readonly<Record<string, ReaderProgress>>,
    bookmarksByBook: Readonly<Record<string, ReadonlyArray<ReaderBookmark>>>,
    activeBookId: string | null,
    annotationsByBook: Readonly<Record<string, ReadonlyArray<ReaderAnnotation>>>,
    preferRestoredActive = false,
  ): ReadonlyArray<ReaderBook> {
    const currentById = new Map(this.state.library.map((book) => [book.id, book] as const));
    const currentByHash = new Map(
      this.state.library.flatMap((book) =>
        book.source.ref?.hash === undefined ? [] : [[book.source.ref.hash, book] as const],
      ),
    );
    const retained = new Set<string>();
    const recovered: ReaderBook[] = [];
    const merged = library.map((book) => {
      const current =
        currentById.get(book.id) ??
        (book.source.ref?.hash === undefined ? undefined : currentByHash.get(book.source.ref.hash));
      if (current !== undefined) {
        retained.add(current.id);
        return current;
      }
      retained.add(book.id);
      recovered.push(book);
      return book;
    });
    for (const book of this.state.library) {
      if (!retained.has(book.id)) merged.push(book);
    }
    if (recovered.length === 0) return recovered;

    const restoredActive =
      activeBookId === null ? undefined : merged.find((book) => book.id === activeBookId);
    const currentActive =
      this.state.activeBookId === null
        ? undefined
        : merged.find((book) => book.id === this.state.activeBookId);
    const active =
      preferRestoredActive && restoredActive !== undefined
        ? restoredActive
        : (currentActive ?? restoredActive ?? merged[0] ?? demo);
    const mergedProgress = { ...progressByBook, ...this.state.progressByBook };
    const progress = mergedProgress[active.id] ?? progressForLocator(active, firstLocator(active));
    this.set({
      library: merged,
      activeBookId: active.id,
      activeSectionId: progress.locator.sectionId,
      progressByBook: mergedProgress,
      bookmarksByBook: { ...bookmarksByBook, ...this.state.bookmarksByBook },
      annotationsByBook: { ...annotationsByBook, ...this.state.annotationsByBook },
    });
    return recovered;
  }

  addBook(book: ReaderBook): boolean {
    const existing = this.state.library.find(
      (candidate) =>
        candidate.id === book.id ||
        (candidate.source.ref?.hash !== undefined &&
          candidate.source.ref.hash === book.source.ref?.hash),
    );
    if (existing !== undefined) {
      // Binary adapters expose ephemeral Blob URLs. Replacing the artifact
      // under the same hash can invalidate a restored URL, so refresh the
      // in-memory publication with the newly parsed resources while keeping
      // the existing reading session and user metadata keyed by book id.
      if (existing.source.objectUrl !== book.source.objectUrl) {
        releaseBookResources(existing);
      }
      const refreshed = {
        ...book,
        title: existing.title,
        ...(existing.author === undefined ? {} : { author: existing.author }),
        ...(existing.language === undefined ? {} : { language: existing.language }),
        importedAt: existing.importedAt,
        updatedAt: Math.max(existing.updatedAt, book.updatedAt),
        tags: existing.tags,
      };
      const library = this.state.library.map((candidate) =>
        candidate.id === existing.id ? refreshed : candidate,
      );
      const progress =
        this.state.progressByBook[existing.id] ??
        progressForLocator(refreshed, firstLocator(refreshed));
      this.set({
        library,
        activeBookId: refreshed.id,
        activeSectionId: progress.locator.sectionId,
        progressByBook: { ...this.state.progressByBook, [refreshed.id]: progress },
        query: "",
        searchHits: [],
        searchBookId: null,
        searchActiveIndex: -1,
        searchReveal: null,
        searchOpen: false,
      });
      return false;
    }
    const library = [...this.state.library.filter((candidate) => candidate.id !== book.id), book];
    const progress =
      this.state.progressByBook[book.id] ?? progressForLocator(book, firstLocator(book));
    this.set({
      library,
      activeBookId: book.id,
      activeSectionId: progress.locator.sectionId,
      progressByBook: { ...this.state.progressByBook, [book.id]: progress },
      bookmarksByBook: {
        ...this.state.bookmarksByBook,
        [book.id]: this.state.bookmarksByBook[book.id] ?? [],
      },
      annotationsByBook: {
        ...this.state.annotationsByBook,
        [book.id]: this.state.annotationsByBook[book.id] ?? [],
      },
      query: "",
      searchHits: [],
      searchBookId: null,
      searchActiveIndex: -1,
      searchReveal: null,
      searchOpen: false,
    });
    return true;
  }

  /** Replace a fast-restored projection with its fully rehydrated source view. */
  replaceBook(book: ReaderBook): boolean {
    const existing = this.state.library.find((candidate) => candidate.id === book.id);
    if (existing === undefined) {
      releaseBookResources(book);
      return false;
    }
    if (existing.source.objectUrl !== book.source.objectUrl) {
      releaseBookResources(existing);
    }
    const storedProgress = this.state.progressByBook[book.id];
    const progress =
      storedProgress === undefined
        ? progressForLocator(book, firstLocator(book))
        : progressForLocator(book, storedProgress.locator);
    const library = this.state.library.map((candidate) =>
      candidate.id === book.id ? book : candidate,
    );
    this.set({
      library,
      activeSectionId:
        this.state.activeBookId === book.id
          ? progress.locator.sectionId
          : this.state.activeSectionId,
      progressByBook: { ...this.state.progressByBook, [book.id]: progress },
    });
    return true;
  }

  removeBook(bookId: string): void {
    const removed = this.state.library.find((book) => book.id === bookId);
    if (removed !== undefined) releaseBookResources(removed);
    const library = this.state.library.filter((book) => book.id !== bookId);
    const fallback = library[0] ?? demo;
    const nextLibrary = library.length > 0 ? library : [demo];
    const progress =
      this.state.progressByBook[fallback.id] ??
      progressForLocator(fallback, firstLocator(fallback));
    const progressByBook = { ...this.state.progressByBook };
    delete progressByBook[bookId];
    const bookmarksByBook = { ...this.state.bookmarksByBook };
    delete bookmarksByBook[bookId];
    const annotationsByBook = { ...this.state.annotationsByBook };
    delete annotationsByBook[bookId];
    this.set({
      navigationHistory: {
        back: this.state.navigationHistory.back.filter((entry) => entry.bookId !== bookId),
        forward: this.state.navigationHistory.forward.filter((entry) => entry.bookId !== bookId),
      },
      library: nextLibrary,
      activeBookId: fallback.id,
      activeSectionId: progress.locator.sectionId,
      progressByBook,
      bookmarksByBook,
      annotationsByBook,
      query: "",
      searchHits: [],
      searchBookId: null,
      searchActiveIndex: -1,
      searchReveal: null,
    });
  }

  openBook(bookId: string, sectionId?: string, remember = true): void {
    const book = this.state.library.find((candidate) => candidate.id === bookId);
    if (book === undefined) return;
    if (remember) this.rememberPosition();
    const stored = this.state.progressByBook[book.id];
    const locator =
      sectionId === undefined
        ? (stored?.locator ?? firstLocator(book))
        : normalizeLocator(book, {
            kind: "section",
            sectionId,
            progression: 0,
          });
    const progress = progressForLocator(book, locator);
    this.set({
      activeBookId: book.id,
      activeSectionId: progress.locator.sectionId,
      navigationSequence: this.state.navigationSequence + 1,
      progressByBook: { ...this.state.progressByBook, [book.id]: progress },
      query: "",
      searchHits: [],
      searchBookId: null,
      searchActiveIndex: -1,
      searchReveal: null,
      searchOpen: false,
    });
  }

  openBookmark(bookId: string, bookmarkId: string): void {
    const book = this.state.library.find((candidate) => candidate.id === bookId);
    const bookmark = this.state.bookmarksByBook[bookId]?.find(
      (candidate) => candidate.id === bookmarkId,
    );
    if (book === undefined || bookmark === undefined) return;
    this.rememberPosition();
    const progress = progressForLocator(book, bookmark.locator);
    this.set({
      activeBookId: book.id,
      activeSectionId: progress.locator.sectionId,
      navigationSequence: this.state.navigationSequence + 1,
      progressByBook: { ...this.state.progressByBook, [book.id]: progress },
      query: "",
      searchHits: [],
      searchBookId: null,
      searchActiveIndex: -1,
      searchReveal: null,
      searchOpen: false,
    });
  }

  openAnnotation(bookId: string, annotationId: string): void {
    const book = this.state.library.find((candidate) => candidate.id === bookId);
    const annotation = this.state.annotationsByBook[bookId]?.find(
      (candidate) => candidate.id === annotationId,
    );
    if (book === undefined || annotation === undefined) return;
    this.rememberPosition();
    const progress = progressForLocator(book, annotation.locator);
    this.set({
      activeBookId: book.id,
      activeSectionId: progress.locator.sectionId,
      navigationSequence: this.state.navigationSequence + 1,
      progressByBook: { ...this.state.progressByBook, [book.id]: progress },
      query: "",
      searchHits: [],
      searchBookId: null,
      searchActiveIndex: -1,
      searchReveal: null,
      searchOpen: false,
    });
  }

  setLocator(locator: ReaderLocator, percentage?: number): void {
    const book = activeBook(this.state);
    if (book === undefined) return;
    const progress = progressForLocator(book, locator);
    const nextProgress = percentage === undefined ? progress : { ...progress, percentage };
    const currentProgress = this.state.progressByBook[book.id];
    const currentAnchorStart = currentProgress?.locator.textAnchor?.start;
    const nextAnchorStart = nextProgress.locator.textAnchor?.start;
    const bothTextAnchored = currentAnchorStart !== undefined && nextAnchorStart !== undefined;
    const currentImage = currentProgress?.locator.imageAnchor;
    const nextImage = nextProgress.locator.imageAnchor;
    const sameLocalPosition =
      currentImage !== undefined || nextImage !== undefined
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
    this.set({
      activeSectionId: nextProgress.locator.sectionId,
      progressByBook: {
        ...this.state.progressByBook,
        [book.id]: nextProgress,
      },
    });
  }

  private currentPosition(): ReaderHistoryEntry | undefined {
    if (typeof window !== "undefined")
      window.dispatchEvent(new Event("bcr-reader-capture-progress"));
    const bookId = this.state.activeBookId;
    const locator = bookId === null ? undefined : this.state.progressByBook[bookId]?.locator;
    return bookId === null || locator === undefined ? undefined : { bookId, locator };
  }

  private rememberPosition(): void {
    const entry = this.currentPosition();
    if (entry === undefined) return;
    const back = this.state.navigationHistory.back;
    const last = back.at(-1);
    this.set({
      navigationHistory: {
        back:
          last?.bookId === entry.bookId && sameLocator(last.locator, entry.locator)
            ? back
            : [...back, entry].slice(-50),
        forward: [],
      },
    });
  }

  navigateHistory(direction: "back" | "forward", distance = 1): void {
    const current = this.currentPosition();
    const history = this.state.navigationHistory;
    const entries = history[direction].filter((entry) =>
      this.state.library.some((book) => book.id === entry.bookId),
    );
    const count = Math.max(1, Math.min(entries.length, Math.floor(distance)));
    const target = entries.at(-count);
    const book = this.state.library.find((item) => item.id === target?.bookId);
    if (target === undefined || book === undefined) return;
    const other = direction === "back" ? "forward" : "back";
    const progress = progressForLocator(book, target.locator);
    this.set({
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
      progressByBook: { ...this.state.progressByBook, [book.id]: progress },
      navigationSequence: this.state.navigationSequence + 1,
      searchReveal: null,
      searchBookId: null,
      searchOpen: false,
    });
  }

  setSearchScope(searchScope: ReaderState["searchScope"]): void {
    this.set({ searchScope, searchHits: [], searchActiveIndex: -1, searchBusy: true });
  }

  setSearch(query: string, hits: ReadonlyArray<SearchHit>, bookId: string | null): void {
    const previous =
      this.state.query === query ? this.state.searchHits[this.state.searchActiveIndex] : undefined;
    const selected =
      previous === undefined
        ? -1
        : hits.findIndex(
            (hit) =>
              hit.bookId === previous.bookId &&
              hit.sectionId === previous.sectionId &&
              hit.matchStart === previous.matchStart,
          );
    this.set({
      query,
      searchHits: hits,
      searchBookId: bookId,
      searchActiveIndex: selected >= 0 ? selected : hits.length > 0 ? 0 : -1,
      searchBusy: false,
      searchReveal: null,
    });
  }

  setSearchBusy(searchBusy: boolean): void {
    this.set({ searchBusy });
  }

  moveSearch(delta: number): void {
    const count = this.state.searchHits.length;
    if (count === 0) return;
    const current = this.state.searchActiveIndex < 0 ? 0 : this.state.searchActiveIndex;
    const next = (current + delta + count) % count;
    this.set({ searchActiveIndex: next });
  }

  setSearchActiveIndex(searchActiveIndex: number): void {
    if (this.state.searchHits.length === 0) return;
    this.set({
      searchActiveIndex: Math.min(this.state.searchHits.length - 1, Math.max(0, searchActiveIndex)),
    });
  }

  revealSearchHit(hit: SearchHit): void {
    const reveal: ReaderSearchReveal = {
      id: ++this.searchRevealSequence,
      bookId: hit.bookId,
      sectionId: hit.sectionId,
      matchStart: Math.max(0, hit.matchStart),
      matchLength: Math.max(0, hit.matchLength),
    };
    this.set({ searchReveal: reveal });
  }

  clearSearchReveal(id: number): void {
    if (this.state.searchReveal?.id !== id) return;
    this.set({ searchReveal: null });
  }

  setSettings(patch: Partial<ReaderSettings>): void {
    this.set({ settings: { ...this.state.settings, ...patch } });
  }

  restoreReadingHistory(
    history: ReaderState["navigationHistory"],
    search?: ReaderSearchSession,
  ): void {
    this.set({
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

  toggleSidebar(): void {
    this.set({ sidebarOpen: !this.state.sidebarOpen });
  }

  setSearchOpen(searchOpen: boolean): void {
    this.set({ searchOpen });
  }

  toggleBookmark(): void {
    const book = activeBook(this.state);
    if (book === undefined) return;
    const progress =
      this.state.progressByBook[book.id] ?? progressForLocator(book, firstLocator(book));
    const current = this.state.bookmarksByBook[book.id] ?? [];
    const existing = current.findIndex((bookmark) =>
      sameLocator(bookmark.locator, progress.locator),
    );
    if (existing >= 0) {
      this.set({
        bookmarksByBook: {
          ...this.state.bookmarksByBook,
          [book.id]: current.filter((_bookmark, index) => index !== existing),
        },
      });
      return;
    }
    const now = Date.now();
    const section = book.sections.find((candidate) => candidate.id === progress.locator.sectionId);
    const bookmark: ReaderBookmark = {
      id: `bookmark-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      label: section?.label ?? "阅读位置",
      locator: progress.locator,
      createdAt: now,
    };
    this.set({
      bookmarksByBook: {
        ...this.state.bookmarksByBook,
        [book.id]: [...current, bookmark],
      },
    });
  }

  removeBookmark(bookId: string, bookmarkId: string): void {
    const current = this.state.bookmarksByBook[bookId] ?? [];
    const next = current.filter((bookmark) => bookmark.id !== bookmarkId);
    if (next.length === current.length) return;
    this.set({ bookmarksByBook: { ...this.state.bookmarksByBook, [bookId]: next } });
  }

  addAnnotation(note: string, locator?: ReaderLocator): void {
    const book = activeBook(this.state);
    const trimmed = note.trim();
    if (book === undefined || trimmed.length === 0) return;
    const progress =
      locator === undefined
        ? (this.state.progressByBook[book.id] ?? progressForLocator(book, firstLocator(book)))
        : progressForLocator(book, locator);
    const current = this.state.annotationsByBook[book.id] ?? [];
    const now = Date.now();
    const section = book.sections.find((candidate) => candidate.id === progress.locator.sectionId);
    const annotation: ReaderAnnotation = {
      id: `annotation-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      label: section?.label ?? "阅读位置",
      note: trimmed.slice(0, 2_000),
      locator: progress.locator,
      createdAt: now,
      updatedAt: now,
    };
    this.set({
      annotationsByBook: {
        ...this.state.annotationsByBook,
        [book.id]: [annotation, ...current],
      },
    });
  }

  removeAnnotation(bookId: string, annotationId: string): void {
    const current = this.state.annotationsByBook[bookId] ?? [];
    const next = current.filter((annotation) => annotation.id !== annotationId);
    if (next.length === current.length) return;
    this.set({ annotationsByBook: { ...this.state.annotationsByBook, [bookId]: next } });
  }

  markSaved(): void {
    this.set({ lastSavedAt: Date.now(), saveError: null });
  }

  markSaveFailed(reason: unknown): void {
    this.set({ saveError: reason instanceof Error ? reason.message : String(reason) });
  }
}

export const reader = new ReaderStore();

export function useReader<T>(selector: (state: ReaderState) => T): T {
  return useSyncExternalStore(
    reader.subscribe,
    () => selector(reader.getSnapshot()),
    () => selector(reader.getSnapshot()),
  );
}

export function getReaderState(): ReaderState {
  return reader.getSnapshot();
}
