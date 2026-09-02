import type { ReaderBook, ReaderSection, SearchHit } from "./model";

/**
 * Worker-friendly search index document. It deliberately stores only the
 * normalized body and lightweight metadata; the original publication stays
 * in the ReaderBook owned by the session/UI.
 */
export interface ReaderIndexDocument {
  readonly bookId: string;
  readonly sectionId: string;
  readonly label: string;
  readonly normalizedText: string;
  readonly length: number;
}

export type ReaderIndexBook = Pick<ReaderBook, "id"> & {
  readonly sections: ReadonlyArray<Pick<ReaderSection, "id" | "label" | "text">>;
};

export function normalizeSearchQuery(query: string): string {
  return query.normalize("NFKC").trim().replace(/\s+/gu, "").toLocaleLowerCase();
}

export function makeSnippet(text: string, start: number, length: number, radius = 58): string {
  const safeStart = Math.max(0, start);
  const from = Math.max(0, safeStart - radius);
  const to = Math.min(text.length, safeStart + length + radius);
  const prefix = from > 0 ? "…" : "";
  const suffix = to < text.length ? "…" : "";
  return `${prefix}${text.slice(from, to).replace(/\s+/gu, " ").trim()}${suffix}`;
}

function findMatch(
  section: ReaderSection,
  normalizedQuery: string,
): { start: number; length: number } | undefined {
  if (!normalizedQuery || !section.text) return undefined;
  const normalizedText = section.text.normalize("NFKC").toLocaleLowerCase();
  const start = normalizedText.indexOf(normalizedQuery);
  return start < 0 ? undefined : { start, length: normalizedQuery.length };
}

export function buildSearchIndex(
  book: ReaderIndexBook,
  onProgress: (value: number) => void = () => undefined,
): ReadonlyArray<ReaderIndexDocument> {
  const total = Math.max(1, book.sections.length);
  return book.sections.map((section, index) => {
    const normalizedText = section.text.normalize("NFKC").toLocaleLowerCase();
    onProgress((index + 1) / total);
    return {
      bookId: book.id,
      sectionId: section.id,
      label: section.label,
      normalizedText,
      length: normalizedText.length,
    };
  });
}

export function searchIndexedDocuments(
  documents: ReadonlyArray<ReaderIndexDocument>,
  books: ReadonlyArray<ReaderBook>,
  query: string,
  limit = 80,
): ReadonlyArray<SearchHit> {
  const normalized = normalizeSearchQuery(query);
  if (!normalized) return [];
  const booksById = new Map(books.map((book) => [book.id, book]));
  const hits: SearchHit[] = [];
  for (const document of documents) {
    const start = document.normalizedText.indexOf(normalized);
    if (start < 0) continue;
    const book = booksById.get(document.bookId);
    const section = book?.sections.find((candidate) => candidate.id === document.sectionId);
    if (section === undefined) continue;
    const occurrences = document.normalizedText.split(normalized).length - 1;
    hits.push({
      bookId: document.bookId,
      sectionId: document.sectionId,
      label: document.label,
      snippet: makeSnippet(section.text, start, normalized.length),
      score: occurrences > 1 ? occurrences + 1 : 1,
      matchStart: start,
      matchLength: normalized.length,
    });
    if (hits.length >= limit) break;
  }
  return hits.sort((a, b) => b.score - a.score || a.sectionId.localeCompare(b.sectionId));
}

export function searchBook(book: ReaderBook, query: string, limit = 80): ReadonlyArray<SearchHit> {
  const normalized = normalizeSearchQuery(query);
  if (!normalized) return [];
  const hits: SearchHit[] = [];
  for (const section of book.sections) {
    const match = findMatch(section, normalized);
    if (match === undefined) continue;
    const occurrences =
      section.text.normalize("NFKC").toLocaleLowerCase().split(normalized).length - 1;
    hits.push({
      bookId: book.id,
      sectionId: section.id,
      label: section.label,
      snippet: makeSnippet(section.text, match.start, match.length),
      score: occurrences > 1 ? occurrences + 1 : 1,
      matchStart: match.start,
      matchLength: match.length,
    });
    if (hits.length >= limit) break;
  }
  return hits.sort((a, b) => b.score - a.score || a.sectionId.localeCompare(b.sectionId));
}

export function searchLibrary(
  books: ReadonlyArray<ReaderBook>,
  query: string,
  limit = 80,
): ReadonlyArray<SearchHit> {
  return books.flatMap((book) => searchBook(book, query, limit)).slice(0, limit);
}
