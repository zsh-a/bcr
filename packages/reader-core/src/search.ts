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

export interface SearchTextRange {
  /** UTF-16 offset in the original section text. */
  readonly start: number;
  /** Number of UTF-16 code units in the original section text. */
  readonly length: number;
}

export function normalizeSearchQuery(query: string): string {
  return query.normalize("NFKC").trim().replace(/\s+/gu, "").toLocaleLowerCase();
}

interface NormalizedText {
  readonly value: string;
  readonly starts: ReadonlyArray<number>;
  readonly ends: ReadonlyArray<number>;
}

/**
 * Normalize a section while retaining a mapping back to its source offsets.
 * Search treats compatibility forms and whitespace consistently, but the UI
 * still needs to highlight the unmodified publication text.
 */
function normalizeTextWithOffsets(value: string, includeOffsets = true): NormalizedText {
  let normalized = "";
  const starts: number[] = [];
  const ends: number[] = [];
  for (let index = 0; index < value.length;) {
    const start = index;
    const codePoint = value.codePointAt(index) ?? 0;
    index += codePoint > 0xffff ? 2 : 1;
    const character = value.slice(start, index);
    if (/\s/u.test(character)) continue;
    const mapped = character.normalize("NFKC").toLocaleLowerCase();
    normalized += mapped;
    if (!includeOffsets) continue;
    for (let unitIndex = 0; unitIndex < mapped.length; unitIndex += 1) {
      starts.push(start);
      ends.push(index);
    }
  }
  return { value: normalized, starts, ends };
}

/** Return an original-text range for a normalized query, if present. */
export function searchTextRange(text: string, query: string): SearchTextRange | undefined {
  return searchTextRangeNear(text, query, 0);
}

/**
 * Return the occurrence nearest a progression hint while preserving offsets
 * into the unmodified source text. This is useful for repeated prose when a
 * reflowed DOM position still provides an approximate place in the section.
 */
export function searchTextRangeNear(
  text: string,
  query: string,
  progression: number,
): SearchTextRange | undefined {
  const normalizedQuery = normalizeSearchQuery(query);
  if (!normalizedQuery || !text) return undefined;
  const normalized = normalizeTextWithOffsets(text);
  const target = Math.min(1, Math.max(0, progression)) * normalized.value.length;
  let index = normalized.value.indexOf(normalizedQuery);
  if (index < 0) return undefined;
  let selected = index;
  while (index >= 0) {
    if (Math.abs(index - target) < Math.abs(selected - target)) selected = index;
    index = normalized.value.indexOf(normalizedQuery, index + Math.max(1, normalizedQuery.length));
  }
  index = selected;
  const endIndex = index + normalizedQuery.length - 1;
  const start = normalized.starts[index];
  const end = normalized.ends[endIndex];
  if (start === undefined || end === undefined || end < start) return undefined;
  return { start, length: end - start };
}

export function makeSnippet(text: string, start: number, length: number, radius = 58): string {
  const safeStart = Math.max(0, start);
  const from = Math.max(0, safeStart - radius);
  const to = Math.min(text.length, safeStart + length + radius);
  const prefix = from > 0 ? "…" : "";
  const suffix = to < text.length ? "…" : "";
  return `${prefix}${text.slice(from, to).replace(/\s+/gu, " ").trim()}${suffix}`;
}

export function buildSearchIndex(
  book: ReaderIndexBook,
  onProgress: (value: number) => void = () => undefined,
): ReadonlyArray<ReaderIndexDocument> {
  const total = Math.max(1, book.sections.length);
  return book.sections.map((section, index) => {
    const normalizedText = normalizeTextWithOffsets(section.text, false).value;
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
    for (const range of searchTextRanges(section.text, query, limit - hits.length))
      hits.push({
        bookId: document.bookId,
        sectionId: document.sectionId,
        label: document.label,
        snippet: makeSnippet(section.text, range.start, range.length),
        score: 1,
        matchStart: range.start,
        matchLength: range.length,
      });
    if (hits.length >= limit) break;
  }
  return hits;
}

/** Every non-overlapping occurrence, in publication order, with original offsets. */
export function searchTextRanges(text: string, query: string, limit = 80): SearchTextRange[] {
  const needle = normalizeSearchQuery(query);
  if (!needle || limit <= 0) return [];
  const mapped = normalizeTextWithOffsets(text);
  const ranges: SearchTextRange[] = [];
  let position = mapped.value.indexOf(needle);
  while (position >= 0 && ranges.length < limit) {
    const start = mapped.starts[position]!;
    const end = mapped.ends[position + needle.length - 1]!;
    ranges.push({ start, length: end - start });
    position = mapped.value.indexOf(needle, position + needle.length);
  }
  return ranges;
}

export function searchBook(book: ReaderBook, query: string, limit = 80): ReadonlyArray<SearchHit> {
  const normalized = normalizeSearchQuery(query);
  if (!normalized) return [];
  const hits: SearchHit[] = [];
  for (const section of book.sections) {
    for (const match of searchTextRanges(section.text, normalized, limit - hits.length))
      hits.push({
        bookId: book.id,
        sectionId: section.id,
        label: section.label,
        snippet: makeSnippet(section.text, match.start, match.length),
        score: 1,
        matchStart: match.start,
        matchLength: match.length,
      });
    if (hits.length >= limit) break;
  }
  return hits;
}

export function searchLibrary(
  books: ReadonlyArray<ReaderBook>,
  query: string,
  limit = 80,
): ReadonlyArray<SearchHit> {
  return books.flatMap((book) => searchBook(book, query, limit)).slice(0, limit);
}
