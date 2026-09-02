import { describe, expect, it } from "vitest";
import {
  createLocator,
  locatorAtPercentage,
  normalizeLocator,
  percentageForLocator,
} from "../src/locator";
import {
  buildSearchIndex,
  normalizeSearchQuery,
  searchBook,
  searchIndexedDocuments,
} from "../src/search";
import type { ReaderBook } from "../src/model";

const book: ReaderBook = {
  id: "book-1",
  title: "阅读器测试",
  source: { name: "test.txt", format: "txt", mime: "text/plain", size: 10 },
  sections: [
    {
      id: "a",
      order: 0,
      label: "第一章",
      kind: "text",
      text: "你好，世界。阅读器让内容回到中心。",
    },
    { id: "b", order: 1, label: "第二章", kind: "text", text: "搜索和进度应该是可恢复的。" },
    { id: "c", order: 2, label: "第三章", kind: "text", text: "现代架构也需要安静的界面。" },
  ],
  importedAt: 1,
  updatedAt: 1,
  tags: [],
};

describe("reader-core", () => {
  it("normalizes CJK and whitespace search input", () => {
    expect(normalizeSearchQuery("  阅读器　 让 内容 ")).toBe("阅读器让内容");
  });

  it("searches section text and returns stable snippets", () => {
    const hits = searchBook(book, "进度");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.sectionId).toBe("b");
    expect(hits[0]?.snippet).toContain("进度");
  });

  it("builds a worker-safe index that preserves search semantics", () => {
    const documents = buildSearchIndex(book);
    expect(documents).toHaveLength(3);
    expect(searchIndexedDocuments(documents, [book], "进度")[0]).toMatchObject({
      bookId: "book-1",
      sectionId: "b",
    });
  });

  it("round-trips locators across section progress", () => {
    const locator = createLocator(book.sections[1]!, 0.4);
    expect(percentageForLocator(book, locator)).toBeCloseTo(0.7);
    const restored = locatorAtPercentage(book, 0.7);
    expect(restored.sectionId).toBe("b");
    expect(restored.progression).toBeCloseTo(0.4);
  });

  it("recovers semantic href/page locators when section ids change", () => {
    const epubBook: ReaderBook = {
      ...book,
      sections: book.sections.map((section, index) => ({
        ...section,
        id: `epub-${index + 1}-new`,
        href: `chapter-${index + 1}.xhtml`,
      })),
    };
    const oldLocator = {
      kind: "section" as const,
      sectionId: "section-2-old",
      href: "chapter-2.xhtml",
      progression: 0.2,
    };
    expect(normalizeLocator(epubBook, oldLocator)).toMatchObject({
      sectionId: "epub-2-new",
      href: "chapter-2.xhtml",
      progression: 0.2,
    });
  });
});
