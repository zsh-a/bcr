import {
  makeSnippet,
  normalizeSearchQuery,
  searchLibrary,
  searchTextRange,
  type ReaderBook,
  type SearchHit,
} from "@bcr/reader-core";
import type { ReaderRuntime } from "./readerRuntimeCore";

export interface ReaderSearchResult {
  readonly hits: ReadonlyArray<SearchHit>;
  readonly indexing: boolean;
}
export async function indexBook(
  runtime: ReaderRuntime,
  book: ReaderBook,
  signal?: AbortSignal,
): Promise<void> {
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
      hits: [...workerResults.hits, ...searchLibrary(pendingBooks, query)]
        .sort(
          (left, right) =>
            right.score - left.score || left.sectionId.localeCompare(right.sectionId),
        )
        .slice(0, 80),
      indexing: workerResults.pendingBookIds.length > 0,
    };
  }
  if (!runtime.ftsReady || runtime.meta === undefined || normalized.length < 3)
    return { hits: searchLibrary(books, query), indexing: false };
  try {
    const escaped = normalized.replaceAll('"', '""');
    const rows = runtime.meta.all(
      "SELECT book_id, section_id, label, snippet(reader_fts, 3, '<mark>', '</mark>', '…', 18) AS snippet, bm25(reader_fts) AS rank FROM reader_fts WHERE reader_fts MATCH ? ORDER BY rank LIMIT 80",
      [`"${escaped}"`],
    );
    if (rows.length === 0) return { hits: searchLibrary(books, query), indexing: false };
    return {
      hits: rows.flatMap((row) => {
        const bookId = String(row["book_id"] ?? "");
        const sectionId = String(row["section_id"] ?? "");
        const book = books.find((candidate) => candidate.id === bookId);
        const section = book?.sections.find((candidate) => candidate.id === sectionId);
        if (section === undefined) return [];
        const range = searchTextRange(section.text, query);
        return [
          {
            bookId,
            sectionId,
            label: String(row["label"] ?? section.label ?? "正文"),
            snippet:
              range === undefined
                ? String(row["snippet"] ?? "").replace(/<\/?mark>/gu, "")
                : makeSnippet(section.text, range.start, range.length),
            score: Number(row["rank"] ?? 0),
            matchStart: range?.start ?? 0,
            matchLength: range?.length ?? normalized.length,
          },
        ];
      }),
      indexing: false,
    };
  } catch {
    return { hits: searchLibrary(books, query), indexing: false };
  }
}

export function searchIndexed(
  runtime: ReaderRuntime,
  books: ReadonlyArray<ReaderBook>,
  query: string,
): ReadonlyArray<SearchHit> {
  return searchIndexedDetailed(runtime, books, query).hits;
}
