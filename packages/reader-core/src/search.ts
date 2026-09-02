import type { ReaderBook, ReaderSection, SearchHit } from "./model";

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
