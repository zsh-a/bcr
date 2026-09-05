import { describe, expect, it } from "vitest";
import {
  buildSearchIndex,
  searchBook,
  searchIndexedDocuments,
  searchTextRanges,
  type ReaderBook,
} from "../src/index";

describe("Reader occurrence search", () => {
  it("maps every normalized match to the original UTF-16 range", () => {
    const text = "Ａ b / AB / a\nb";
    expect(searchTextRanges(text, "ab")).toEqual([
      { start: 0, length: 3 },
      { start: 6, length: 2 },
      { start: 11, length: 3 },
    ]);
    expect(searchTextRanges(text, "ab", 2)).toHaveLength(2);
    expect(searchTextRanges(text, "", 2)).toEqual([]);
  });
  it("keeps worker and fallback hits in reading order, not section-id order", () => {
    const book: ReaderBook = {
      id: "book",
      title: "Book",
      source: { name: "a.txt", mime: "text/plain", format: "txt", size: 1 },
      sections: [
        { id: "z", order: 0, label: "First", kind: "text", text: "hit then hit" },
        { id: "a", order: 1, label: "Second", kind: "text", text: "hit" },
      ],
      importedAt: 1,
      updatedAt: 1,
      tags: [],
    };
    const hits = searchBook(book, "hit");
    expect(hits.map((hit) => [hit.sectionId, hit.matchStart])).toEqual([
      ["z", 0],
      ["z", 9],
      ["a", 0],
    ]);
    expect(searchIndexedDocuments(buildSearchIndex(book), [book], "hit")).toEqual(hits);
  });
});
