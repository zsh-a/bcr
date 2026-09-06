import {
  textVersion,
  citationFromParams,
  resolveTextCitation,
  type CitationSource,
  type CitationResolution,
  type SearchDocument,
} from "@bcr/core";
import type { ReaderBook, ReaderSection } from "@bcr/reader-core";

export function readerCitationSource(
  bookId: string,
  section: Pick<ReaderSection, "id" | "text">,
): CitationSource {
  const scope = JSON.stringify(["reader", bookId, section.id]);
  return { scope, unit: scope, version: textVersion(section.text), offset: 0 };
}
export function resolveReaderCitation(
  bookId: string,
  section: ReaderSection,
  params: URLSearchParams,
): CitationResolution {
  const citation = citationFromParams(params);
  if (!citation) return { status: "changed" };
  return resolveTextCitation(citation, [
    { text: section.text, source: readerCitationSource(bookId, section) },
  ]);
}

/** Bounded excerpts cover the complete chapter; offsets remain original UTF-16 positions. */
export function readerResearchDocuments(book: ReaderBook): SearchDocument[] {
  return book.sections.flatMap((section) => {
    const records: SearchDocument[] = [];
    const source = readerCitationSource(book.id, section);
    for (let start = 0; start < Math.max(1, section.text.length); start += 1680) {
      let end = Math.min(section.text.length, start + 1800);
      // Do not split an astral character at either boundary.
      const from =
        start > 0 && /[\uDC00-\uDFFF]/u.test(section.text[start] ?? "") ? start - 1 : start;
      if (end < section.text.length && /[\uDC00-\uDFFF]/u.test(section.text[end] ?? "")) end += 1;
      const text = section.text.slice(from, end);
      const params = new URLSearchParams({
        book: book.id,
        section: section.id,
        start: String(from),
        end: String(end),
        quote: text.slice(0, 128),
      });
      records.push({
        id: `reader:section:${book.id}:${section.id}:${from}`,
        source: "reader",
        kind: "reader-section",
        title: section.label,
        subtitle: `${book.title} · 正文 ${from + 1}–${end}`,
        body: text,
        tags: ["reader", book.source.format, "section"],
        route: `/reader?${params}`,
        updatedAt: book.updatedAt,
        citation: { ...source, offset: from },
      });
      if (end === section.text.length) break;
    }
    return records;
  });
}

export function resolveResearchRange(
  text: string,
  params: URLSearchParams,
): { start: number; end: number } | undefined {
  const rawStart = params.get("start");
  const rawEnd = params.get("end");
  if (rawStart === null || rawEnd === null || !/^\d+$/u.test(rawStart) || !/^\d+$/u.test(rawEnd))
    return undefined;
  const start = Number(rawStart);
  const end = Number(rawEnd);
  const quote = params.get("quote");
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end <= start ||
    end > text.length ||
    !quote ||
    !text.slice(start, end).startsWith(quote)
  )
    return undefined;
  return { start, end };
}
