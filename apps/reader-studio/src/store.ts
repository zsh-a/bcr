import { useSyncExternalStore } from "react";
import {
  firstLocator,
  normalizeLocator,
  progressForLocator,
  type ReaderBook,
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
} from "./model";

const demo = createDemoBook();

function initialState(): ReaderState {
  const progress = progressForLocator(demo, firstLocator(demo), Date.now());
  return {
    status: "booting",
    error: null,
    library: [demo],
    activeBookId: demo.id,
    activeSectionId: demo.sections[0]?.id ?? null,
    progressByBook: { [demo.id]: progress },
    query: "",
    searchHits: [],
    searchBookId: null,
    searchBusy: false,
    settings: DEFAULT_READER_SETTINGS,
    sidebarOpen: true,
    searchOpen: false,
    lastSavedAt: null,
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
    this.set({ status: "error", error: error instanceof Error ? error.message : String(error) });
  }

  hydrate(
    library: ReadonlyArray<ReaderBook>,
    progressByBook: Readonly<Record<string, ReaderProgress>>,
    settings: ReaderSettings,
  ): void {
    const nextLibrary = library.length > 0 ? library : [demo];
    const first = nextLibrary[0] ?? demo;
    const current =
      this.state.activeBookId !== null
        ? nextLibrary.find((book) => book.id === this.state.activeBookId)
        : undefined;
    const active = current ?? first;
    const progress = progressByBook[active.id] ?? progressForLocator(active, firstLocator(active));
    this.set({
      library: nextLibrary,
      activeBookId: active.id,
      activeSectionId: progress.locator.sectionId,
      progressByBook,
      settings,
      status: "ready",
      error: null,
    });
  }

  addBook(book: ReaderBook): void {
    const library = [...this.state.library.filter((candidate) => candidate.id !== book.id), book];
    const progress =
      this.state.progressByBook[book.id] ?? progressForLocator(book, firstLocator(book));
    this.set({
      library,
      activeBookId: book.id,
      activeSectionId: progress.locator.sectionId,
      progressByBook: { ...this.state.progressByBook, [book.id]: progress },
      query: "",
      searchHits: [],
      searchBookId: null,
      searchOpen: false,
    });
  }

  removeBook(bookId: string): void {
    const removed = this.state.library.find((book) => book.id === bookId);
    if (removed?.source.objectUrl !== undefined) URL.revokeObjectURL(removed.source.objectUrl);
    if (removed?.coverUrl !== undefined) URL.revokeObjectURL(removed.coverUrl);
    for (const section of removed?.sections ?? []) {
      if (section.imageUrl !== undefined) URL.revokeObjectURL(section.imageUrl);
    }
    const library = this.state.library.filter((book) => book.id !== bookId);
    const fallback = library[0] ?? demo;
    const nextLibrary = library.length > 0 ? library : [demo];
    const progress =
      this.state.progressByBook[fallback.id] ??
      progressForLocator(fallback, firstLocator(fallback));
    const progressByBook = { ...this.state.progressByBook };
    delete progressByBook[bookId];
    this.set({
      library: nextLibrary,
      activeBookId: fallback.id,
      activeSectionId: progress.locator.sectionId,
      progressByBook,
      query: "",
      searchHits: [],
      searchBookId: null,
    });
  }

  openBook(bookId: string, sectionId?: string): void {
    const book = this.state.library.find((candidate) => candidate.id === bookId);
    if (book === undefined) return;
    const stored = this.state.progressByBook[book.id];
    const locator =
      sectionId === undefined
        ? (stored?.locator ?? firstLocator(book))
        : normalizeLocator(book, { kind: "section", sectionId, progression: 0 });
    const progress = progressForLocator(book, locator);
    this.set({
      activeBookId: book.id,
      activeSectionId: progress.locator.sectionId,
      progressByBook: { ...this.state.progressByBook, [book.id]: progress },
      query: "",
      searchHits: [],
      searchBookId: null,
      searchOpen: false,
    });
  }

  setLocator(locator: ReaderLocator, percentage?: number): void {
    const book = activeBook(this.state);
    if (book === undefined) return;
    const progress = progressForLocator(book, locator);
    this.set({
      activeSectionId: progress.locator.sectionId,
      progressByBook: {
        ...this.state.progressByBook,
        [book.id]: percentage === undefined ? progress : { ...progress, percentage },
      },
    });
  }

  setSearch(query: string, hits: ReadonlyArray<SearchHit>, bookId: string | null): void {
    this.set({ query, searchHits: hits, searchBookId: bookId, searchBusy: false });
  }

  setSearchBusy(searchBusy: boolean): void {
    this.set({ searchBusy });
  }

  setSettings(patch: Partial<ReaderSettings>): void {
    this.set({ settings: { ...this.state.settings, ...patch } });
  }

  toggleSidebar(): void {
    this.set({ sidebarOpen: !this.state.sidebarOpen });
  }

  setSearchOpen(searchOpen: boolean): void {
    this.set({ searchOpen });
  }

  markSaved(): void {
    this.set({ lastSavedAt: Date.now() });
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
