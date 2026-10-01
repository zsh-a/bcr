import { hasDeferredContent, searchReaderContent } from "./readerContent";
import {
  normalizeSearchQuery,
  searchLibrary,
  type ReaderBook,
  type SearchHit,
} from "@bcr/reader-core";
import type { ReaderRuntime } from "./readerRuntimeCore";

export interface ReaderSearchResult {
  readonly hits: ReadonlyArray<SearchHit>;
  readonly indexing: boolean;
  readonly truncated?: boolean;
}
export async function indexBook(
  runtime: ReaderRuntime,
  book: ReaderBook,
  signal?: AbortSignal,
): Promise<void> {
  if (hasDeferredContent(book)) return;
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  if (runtime.indexSession !== undefined) {
    try {
      await runtime.indexSession.indexBook(book, signal);
    } catch (reason) {
      if (signal?.aborted) throw reason;
      // Search has SQLite/JS fallbacks; a failed worker must not make a book unreadable.
    }
  }
  if (!runtime.ftsReady || runtime.meta === undefined) return;
  try {
    runtime.meta.run("DELETE FROM reader_fts WHERE book_id = ?", [book.id]);
    for (const section of book.sections) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      runtime.meta.run(
        "INSERT INTO reader_fts (book_id, section_id, label, body) VALUES (?, ?, ?, ?)",
        [book.id, section.id, section.label, section.text],
      );
    }
    await runtime.meta.persist();
  } catch (reason) {
    if (signal?.aborted) throw reason;
    // Search always has a JS fallback. A failed index should not make a book unreadable.
  }
}

export function searchIndexedDetailed(
  runtime: ReaderRuntime,
  books: ReadonlyArray<ReaderBook>,
  query: string,
): ReaderSearchResult {
  const normalized = normalizeSearchQuery(query);
  if (!normalized) return { hits: [], indexing: false };
  const workerResults = runtime.indexSession?.search(books, query);
  if (workerResults !== undefined) {
    const indexedBookIds = new Set(workerResults.indexedBookIds);
    const pendingBooks = books.filter((book) => !indexedBookIds.has(book.id));
    return {
      hits: [...workerResults.hits, ...searchLibrary(pendingBooks, query, 81)]
        .sort(
          (left, right) =>
            books.findIndex((book) => book.id === left.bookId) -
              books.findIndex((book) => book.id === right.bookId) ||
            (books
              .find((book) => book.id === left.bookId)
              ?.sections.findIndex((section) => section.id === left.sectionId) ?? 0) -
              (books
                .find((book) => book.id === right.bookId)
                ?.sections.findIndex((section) => section.id === right.sectionId) ?? 0) ||
            left.matchStart - right.matchStart,
        )
        .slice(0, 81),
      indexing: workerResults.pendingBookIds.length > 0,
    };
  }
  // FTS tokenization differs from our whitespace/NFKC substring contract.
  // Without a worker index, enumerate the original text rather than silently
  // returning only the first occurrence or an incomplete set of FTS candidates.
  return { hits: searchLibrary(books, query, 81), indexing: false };
}

export function searchIndexed(
  runtime: ReaderRuntime,
  books: ReadonlyArray<ReaderBook>,
  query: string,
): ReadonlyArray<SearchHit> {
  return searchIndexedDetailed(runtime, books, query).hits;
}

/** Deferred books search through their provider without populating the reading cache. */
export async function searchReaderDetailed(
  runtime: ReaderRuntime,
  books: readonly ReaderBook[],
  query: string,
  signal?: AbortSignal,
): Promise<ReaderSearchResult> {
  const results: ReadonlyArray<SearchHit>[] = [];
  let indexing = false;
  for (const book of books) {
    signal?.throwIfAborted();
    if (hasDeferredContent(book)) results.push(await searchReaderContent(book, query, signal));
    else {
      const result = searchIndexedDetailed(runtime, [book], query);
      results.push(result.hits);
      indexing ||= result.indexing;
    }
  }
  signal?.throwIfAborted();
  // Allocate occurrences in rounds, then retain the existing book/section order.
  // Books with few matches give their unused slots to the remaining books.
  const counts = results.map(() => 0);
  let allocated = 0;
  while (allocated < 80) {
    let added = false;
    for (let index = 0; index < results.length && allocated < 80; index++) {
      if (counts[index]! >= results[index]!.length) continue;
      counts[index] = counts[index]! + 1;
      allocated++;
      added = true;
    }
    if (!added) break;
  }
  return {
    hits: results.flatMap((hits, index) => hits.slice(0, counts[index])),
    indexing,
    truncated: results.some((hits, index) => hits.length > counts[index]!),
  };
}
