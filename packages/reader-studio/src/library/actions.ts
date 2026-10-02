import { releaseReaderContent, releaseBookResources } from "../content/readerContent";
import {
  firstLocator,
  progressForLocator,
  sameLocator,
  type ReaderAnnotation,
  type ReaderBook,
  type ReaderBookmark,
  type ReaderProgress,
} from "@bcr/reader-core";
import { type ReaderState } from "../state/model";
import type { ReaderStatePort } from "../state/port";

export function createReaderLibraryActions(
  port: ReaderStatePort & {
    readonly demo: ReaderBook;
    readonly setSourceError: (bookId: string, message: string | null) => void;
  },
) {
  const { getSnapshot, update, demo, setSourceError } = port;

  function reconcileLibrary(
    library: ReadonlyArray<ReaderBook>,
    progressByBook: Readonly<Record<string, ReaderProgress>>,
    bookmarksByBook: Readonly<Record<string, ReadonlyArray<ReaderBookmark>>>,
    activeBookId: string | null,
    annotationsByBook: Readonly<Record<string, ReadonlyArray<ReaderAnnotation>>>,
    preferRestoredActive = false,
  ): ReadonlyArray<ReaderBook> {
    const currentById = new Map(getSnapshot().library.map((book) => [book.id, book] as const));
    const currentByHash = new Map(
      getSnapshot().library.flatMap((book) =>
        book.preserveSectionSnapshot || book.source.ref?.hash === undefined
          ? []
          : [[book.source.ref.hash, book] as const],
      ),
    );
    const retained = new Set<string>();
    const recovered: ReaderBook[] = [];
    const merged = library.map((book) => {
      const current =
        currentById.get(book.id) ??
        (book.preserveSectionSnapshot || book.source.ref?.hash === undefined
          ? undefined
          : currentByHash.get(book.source.ref.hash));
      if (current !== undefined) {
        retained.add(current.id);
        return current;
      }
      retained.add(book.id);
      recovered.push(book);
      return book;
    });
    for (const book of getSnapshot().library) {
      if (!retained.has(book.id)) merged.push(book);
    }
    if (recovered.length === 0) return recovered;

    const restoredActive =
      activeBookId === null ? undefined : merged.find((book) => book.id === activeBookId);
    const currentActive =
      getSnapshot().activeBookId === null
        ? undefined
        : merged.find((book) => book.id === getSnapshot().activeBookId);
    const active =
      preferRestoredActive && restoredActive !== undefined
        ? restoredActive
        : (currentActive ?? restoredActive ?? merged[0] ?? demo);
    const mergedProgress = { ...progressByBook, ...getSnapshot().progressByBook };
    const progress = mergedProgress[active.id] ?? progressForLocator(active, firstLocator(active));
    update({
      library: merged,
      activeBookId: active.id,
      activeSectionId: progress.locator.sectionId,
      progressByBook: mergedProgress,
      bookmarksByBook: { ...bookmarksByBook, ...getSnapshot().bookmarksByBook },
      annotationsByBook: { ...annotationsByBook, ...getSnapshot().annotationsByBook },
    });
    return recovered;
  }

  function appendRestoredBooks(books: ReadonlyArray<ReaderBook>): void {
    const added = books.filter(
      (book) => !getSnapshot().library.some((current) => current.id === book.id),
    );
    if (added.length) update({ library: [...getSnapshot().library, ...added] });
  }

  function mergeBackupRecords(
    books: ReadonlyArray<ReaderBook>,
    records: Pick<ReaderState, "progressByBook" | "bookmarksByBook" | "annotationsByBook">,
  ): void {
    const added = books.filter(
      (book) => !getSnapshot().library.some((current) => current.id === book.id),
    );
    const active = getSnapshot().activeBookId;
    const progress = active === null ? undefined : records.progressByBook[active];
    const previous = active === null ? undefined : getSnapshot().progressByBook[active];
    const moved =
      progress !== undefined &&
      (previous === undefined || !sameLocator(previous.locator, progress.locator, 0));
    update({
      library: [...getSnapshot().library, ...added],
      ...records,
      ...(progress ? { activeSectionId: progress.locator.sectionId } : {}),
      navigationSequence: getSnapshot().navigationSequence + Number(moved),
    });
  }

  function addBook(book: ReaderBook): boolean {
    const existing = getSnapshot().library.find(
      (candidate) =>
        candidate.id === book.id ||
        (!candidate.preserveSectionSnapshot &&
          candidate.source.ref?.hash !== undefined &&
          candidate.source.ref.hash === book.source.ref?.hash),
    );
    if (existing !== undefined) {
      // Binary adapters expose ephemeral Blob URLs. Replacing the artifact
      // under the same hash can invalidate a restored URL, so refresh the
      // in-memory publication with the newly parsed resources while keeping
      // the existing reading session and user metadata keyed by book id.
      if (
        existing.source.objectUrl !== book.source.objectUrl ||
        existing.coverUrl !== book.coverUrl
      ) {
        releaseBookResources(existing);
      } else if (existing.sections !== book.sections) {
        releaseReaderContent(existing);
      }
      const refreshed = {
        ...book,
        id: existing.id,
        title: existing.title,
        favorite: existing.favorite,
        ...(existing.author === undefined ? {} : { author: existing.author }),
        ...(existing.language === undefined ? {} : { language: existing.language }),
        importedAt: existing.importedAt,
        updatedAt: Math.max(existing.updatedAt, book.updatedAt),
        tags: existing.tags,
      };
      const library = getSnapshot().library.map((candidate) =>
        candidate.id === existing.id ? refreshed : candidate,
      );
      const progress =
        getSnapshot().progressByBook[existing.id] ??
        progressForLocator(refreshed, firstLocator(refreshed));
      update({
        library,
        activeBookId: refreshed.id,
        activeSectionId: progress.locator.sectionId,
        progressByBook: { ...getSnapshot().progressByBook, [refreshed.id]: progress },
        query: "",
        searchHits: [],
        searchBookId: null,
        searchActiveIndex: -1,
        searchReveal: null,
        searchOpen: false,
      });
      setSourceError(existing.id, null);
      return false;
    }
    const library = [
      ...getSnapshot().library.filter((candidate) => candidate.id !== book.id),
      book,
    ];
    const progress =
      getSnapshot().progressByBook[book.id] ?? progressForLocator(book, firstLocator(book));
    update({
      library,
      activeBookId: book.id,
      activeSectionId: progress.locator.sectionId,
      progressByBook: { ...getSnapshot().progressByBook, [book.id]: progress },
      bookmarksByBook: {
        ...getSnapshot().bookmarksByBook,
        [book.id]: getSnapshot().bookmarksByBook[book.id] ?? [],
      },
      annotationsByBook: {
        ...getSnapshot().annotationsByBook,
        [book.id]: getSnapshot().annotationsByBook[book.id] ?? [],
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

  function replaceBook(book: ReaderBook): boolean {
    const existing = getSnapshot().library.find((candidate) => candidate.id === book.id);
    if (existing === undefined) {
      releaseBookResources(book);
      return false;
    }
    if (
      existing.source.objectUrl !== book.source.objectUrl ||
      existing.coverUrl !== book.coverUrl
    ) {
      releaseBookResources(existing);
    } else if (existing.sections !== book.sections) {
      releaseReaderContent(existing);
    }
    const storedProgress = getSnapshot().progressByBook[book.id];
    const progress =
      storedProgress === undefined
        ? progressForLocator(book, firstLocator(book))
        : progressForLocator(book, storedProgress.locator);
    const library = getSnapshot().library.map((candidate) =>
      candidate.id === book.id
        ? {
            ...book,
            title: existing.title,
            favorite: existing.favorite,
            ...(existing.author === undefined ? {} : { author: existing.author }),
            ...(existing.language === undefined ? {} : { language: existing.language }),
            tags: existing.tags,
            importedAt: existing.importedAt,
            updatedAt: Math.max(existing.updatedAt, book.updatedAt),
          }
        : candidate,
    );
    update({
      library,
      activeSectionId:
        getSnapshot().activeBookId === book.id
          ? progress.locator.sectionId
          : getSnapshot().activeSectionId,
      progressByBook: { ...getSnapshot().progressByBook, [book.id]: progress },
    });
    setSourceError(book.id, null);
    return true;
  }

  function removeBook(bookId: string): void {
    removeBooks([bookId]);
  }

  function renameBook(bookId: string, title: string): void {
    const trimmed = title.trim().slice(0, 300);
    const book = getSnapshot().library.find((item) => item.id === bookId);
    if (!book || !trimmed || book.title === trimmed) return;
    update({
      library: getSnapshot().library.map((item) =>
        item.id === bookId
          ? { ...item, title: trimmed, updatedAt: Math.max(Date.now(), item.updatedAt + 1) }
          : item,
      ),
    });
  }

  function toggleFavorite(bookId: string): void {
    if (!getSnapshot().library.some((book) => book.id === bookId)) return;
    update({
      library: getSnapshot().library.map((book) =>
        book.id === bookId
          ? {
              ...book,
              favorite: !book.favorite,
              updatedAt: Math.max(Date.now(), book.updatedAt + 1),
            }
          : book,
      ),
    });
  }

  function removeBooks(bookIds: ReadonlyArray<string>): void {
    const ids = new Set(bookIds);
    const removed = getSnapshot().library.filter((book) => ids.has(book.id));
    if (!removed.length) return;
    removed.forEach(releaseBookResources);
    const library = getSnapshot().library.filter((book) => !ids.has(book.id));
    const fallback =
      library.find((book) => book.id === getSnapshot().activeBookId) ?? library[0] ?? demo;
    const nextLibrary = library.length > 0 ? library : [demo];
    const progress =
      (ids.has(fallback.id) ? undefined : getSnapshot().progressByBook[fallback.id]) ??
      progressForLocator(fallback, firstLocator(fallback));
    const progressByBook = { ...getSnapshot().progressByBook };
    const bookmarksByBook = { ...getSnapshot().bookmarksByBook };
    const annotationsByBook = { ...getSnapshot().annotationsByBook };
    const sourceErrorsByBook = { ...getSnapshot().sourceErrorsByBook };
    const books = { ...getSnapshot().settings.books };
    for (const book of removed) {
      delete progressByBook[book.id];
      delete bookmarksByBook[book.id];
      delete annotationsByBook[book.id];
      delete sourceErrorsByBook[book.id];
      delete books[book.id];
    }
    progressByBook[fallback.id] = progress;
    update({
      navigationHistory: {
        back: getSnapshot().navigationHistory.back.filter((entry) => !ids.has(entry.bookId)),
        forward: getSnapshot().navigationHistory.forward.filter((entry) => !ids.has(entry.bookId)),
      },
      library: nextLibrary,
      activeBookId: fallback.id,
      activeSectionId: progress.locator.sectionId,
      progressByBook,
      bookmarksByBook,
      annotationsByBook,
      sourceErrorsByBook,
      settings: { ...getSnapshot().settings, books },
      navigationSequence:
        getSnapshot().navigationSequence + Number(fallback.id !== getSnapshot().activeBookId),
      query: "",
      searchHits: [],
      searchBookId: null,
      searchActiveIndex: -1,
      searchReveal: null,
      searchError: null,
      searchTruncated: false,
      searchBusy: false,
    });
  }

  return {
    reconcileLibrary,
    appendRestoredBooks,
    mergeBackupRecords,
    addBook,
    replaceBook,
    removeBook,
    renameBook,
    toggleFavorite,
    removeBooks,
  };
}
