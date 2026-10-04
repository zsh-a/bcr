import { createReaderLibraryActions } from "../library/actions";
import { createReaderNavigationActions } from "../navigation/actions";
import { createReaderSearchActions } from "../search/actions";
import { createReaderAnnotationsActions } from "../navigation/annotations";
import {
  firstLocator,
  progressForLocator,
  type ReaderAnnotation,
  type ReaderBook,
  type ReaderBookmark,
  type ReaderProgress,
} from "@bcr/reader-core";
import {
  createDemoBook,
  DEFAULT_READER_SETTINGS,
  type ReaderSettings,
  type ReaderState,
  type ReaderSearchSession,
} from "./model";

const demo = createDemoBook();

export { releaseBookResources } from "../content/readerContent";

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
    seekSequence: 0,
    progressByBook: { [demo.id]: progress },
    bookmarksByBook: { [demo.id]: [] },
    annotationsByBook: { [demo.id]: [] },
    query: "",
    searchHits: [],
    searchBookId: null,
    searchActiveIndex: -1,
    searchBusy: false,
    searchError: null,
    searchRevision: 0,
    searchTruncated: false,
    searchLimit: 80,
    sourceErrorsByBook: {},
    searchReveal: null,
    settings: DEFAULT_READER_SETTINGS,
    sidebarOpen: false,
    searchOpen: false,
    lastSavedAt: null,
    saveError: null,
  };
}

class ReaderStore {
  private state: ReaderState = initialState();
  private readonly listeners = new Set<() => void>();

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
      searchError: null,
      searchBusy: false,
      searchTruncated: false,
      searchLimit: 80,
      sourceErrorsByBook: {},
      settings,
      status: "ready",
      error: null,
    });
  }
  private readonly library = createReaderLibraryActions({
    getSnapshot: this.getSnapshot,
    update: (partial) => this.set(partial),
    demo,
    setSourceError: (...args) => this.setSourceError(...args),
  });

  reconcileLibrary = this.library.reconcileLibrary;
  appendRestoredBooks = this.library.appendRestoredBooks;
  mergeBackupRecords = this.library.mergeBackupRecords;
  addBook = this.library.addBook;
  replaceBook = this.library.replaceBook;
  removeBook = this.library.removeBook;
  renameBook = this.library.renameBook;
  toggleFavorite = this.library.toggleFavorite;
  removeBooks = this.library.removeBooks;
  private readonly navigation = createReaderNavigationActions({
    getSnapshot: this.getSnapshot,
    update: (partial) => this.set(partial),
  });

  openBook = this.navigation.openBook;
  openBookmark = this.navigation.openBookmark;
  openAnnotation = this.navigation.openAnnotation;
  setLocator = this.navigation.setLocator;
  seekLocator = this.navigation.seekLocator;
  navigateHistory = this.navigation.navigateHistory;
  private readonly search = createReaderSearchActions({
    getSnapshot: this.getSnapshot,
    update: (partial) => this.set(partial),
  });

  setSearchScope = this.search.setSearchScope;
  setSearch = this.search.setSearch;
  setSearchBusy = this.search.setSearchBusy;
  setSearchError = this.search.setSearchError;
  retrySearch = this.search.retrySearch;
  loadMoreSearch = this.search.loadMoreSearch;
  setSearchTruncated = this.search.setSearchTruncated;
  setSourceError = this.search.setSourceError;
  moveSearch = this.search.moveSearch;
  setSearchActiveIndex = this.search.setSearchActiveIndex;
  revealSearchHit = this.search.revealSearchHit;
  clearSearchReveal = this.search.clearSearchReveal;

  setSettings(patch: Partial<ReaderSettings>): void {
    this.set({
      settings: { ...this.state.settings, ...patch },
      ...(patch.tocPinned ? { sidebarOpen: false } : {}),
    });
  }
  restoreReadingHistory = this.navigation.restoreReadingHistory;

  toggleSidebar(): void {
    this.set({
      sidebarOpen: !this.state.sidebarOpen,
      ...(!this.state.sidebarOpen
        ? { settings: { ...this.state.settings, tocPinned: false } }
        : {}),
    });
  }

  setSearchOpen(searchOpen: boolean): void {
    this.set({ searchOpen });
  }
  private readonly annotations = createReaderAnnotationsActions({
    getSnapshot: this.getSnapshot,
    update: (partial) => this.set(partial),
  });

  toggleBookmark = this.annotations.toggleBookmark;
  removeBookmark = this.annotations.removeBookmark;
  renameBookmark = this.annotations.renameBookmark;
  addAnnotation = this.annotations.addAnnotation;
  removeAnnotation = this.annotations.removeAnnotation;
  updateAnnotation = this.annotations.updateAnnotation;

  markSaved(): void {
    this.set({ lastSavedAt: Date.now(), saveError: null });
  }

  markSaveFailed(reason: unknown): void {
    this.set({ saveError: reason instanceof Error ? reason.message : String(reason) });
  }
}

export const reader = new ReaderStore();

export function getReaderState(): ReaderState {
  return reader.getSnapshot();
}
