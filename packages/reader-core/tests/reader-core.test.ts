import { describe, expect, it } from "vitest";
import {
  createTextAnchor,
  createTextLocator,
  createLocator,
  locatorAtPercentage,
  normalizeAnnotation,
  normalizeLocator,
  percentageForLocator,
  resolveTextAnchor,
  sameLocator,
} from "../src/locator";
import {
  buildSearchIndex,
  normalizeSearchQuery,
  searchBook,
  searchIndexedDocuments,
  searchTextRange,
  searchTextRangeNear,
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
  it("reserves completion for the end and weights unequal chapters", () => {
    const weighted = {
      ...book,
      sections: [
        { ...book.sections[0]!, text: "x".repeat(100) },
        { ...book.sections[1]!, text: "x".repeat(900) },
      ],
    };
    expect(percentageForLocator(weighted, createLocator(weighted.sections[1]!, 0))).toBeCloseTo(
      0.1,
    );
    expect(percentageForLocator(weighted, createLocator(weighted.sections[1]!, 1))).toBe(1);
    expect(locatorAtPercentage(weighted, 1).progression).toBe(1);
    for (const fraction of [0, 0.05, 0.1, 0.2, 0.99, 1])
      expect(percentageForLocator(weighted, locatorAtPercentage(weighted, fraction))).toBeCloseTo(
        fraction,
      );
  });
  it("normalizes CJK and whitespace search input", () => {
    expect(normalizeSearchQuery("  阅读器　 让 内容 ")).toBe("阅读器让内容");
  });

  it("searches section text and returns stable snippets", () => {
    const hits = searchBook(book, "进度");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.sectionId).toBe("b");
    expect(hits[0]?.snippet).toContain("进度");
  });

  it("matches compatibility forms and whitespace while returning source offsets", () => {
    const offsetBook: ReaderBook = {
      ...book,
      id: "offset-book",
      sections: [
        {
          id: "offset",
          order: 0,
          label: "偏移",
          kind: "text",
          text: "前文 阅读　器 与 ＡＢ。",
        },
      ],
    };
    const hits = searchBook(offsetBook, "阅读 器");
    expect(hits[0]).toMatchObject({
      sectionId: "offset",
      matchStart: 3,
      matchLength: 4,
    });
    expect(searchTextRange(offsetBook.sections[0]!.text, "ＡＢ")).toEqual({
      start: 10,
      length: 2,
    });
    const indexed = buildSearchIndex(offsetBook);
    expect(indexed[0]?.normalizedText).toContain("阅读器");
    expect(searchIndexedDocuments(indexed, [offsetBook], "阅读 器")[0]).toMatchObject({
      matchStart: 3,
      matchLength: 4,
    });
  });

  it("resolves repeated text near a section progression hint", () => {
    const text = "重复内容。前段文字。重复内容。后段文字。重复内容。";
    expect(searchTextRangeNear(text, "重复 内容", 0.55)).toEqual({
      start: 10,
      length: 4,
    });
    expect(searchTextRangeNear(text, "重复内容", 0.95)).toEqual({
      start: 20,
      length: 4,
    });
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
    const percentage = percentageForLocator(book, locator);
    expect(percentage).toBeCloseTo(
      (book.sections[0]!.text.length + book.sections[1]!.text.length * 0.4) /
        book.sections.reduce((sum, section) => sum + section.text.length, 0),
    );
    const restored = locatorAtPercentage(book, percentage);
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

  it("restores text anchors after reflow and section id changes", () => {
    const source = book.sections[1]!;
    const locator = createTextLocator(source, 3, 7);
    const migratedSection = {
      ...source,
      id: "section-b-new",
      text: `前置内容 ${source.text} 后置内容`,
    };
    const migratedBook = { ...book, sections: [book.sections[0]!, migratedSection] };
    const restored = normalizeLocator(migratedBook, {
      ...locator,
      sectionId: "section-b-old",
    });
    expect(restored.sectionId).toBe("section-b-new");
    expect(restored.textAnchor?.exact).toBe("进度应该");
    expect(restored.textAnchor?.start).toBe(8);
    expect(restored.progression).toBeCloseTo(8 / migratedSection.text.length);
    expect(resolveTextAnchor(migratedSection.text, restored.textAnchor)).toEqual({
      start: 8,
      length: 4,
    });
  });

  it("bounds text anchors so persisted locators cannot grow without limit", () => {
    const text = "x".repeat(800);
    const anchor = createTextAnchor(text, 20, 800, 500);
    expect(anchor?.exact).toHaveLength(512);
    expect(anchor?.prefix).toHaveLength(20);
    expect(anchor?.suffix).toHaveLength(96);
  });

  it("compares bookmark positions with a small reflow tolerance", () => {
    expect(
      sameLocator(createLocator(book.sections[1]!, 0.4), createLocator(book.sections[1]!, 0.415)),
    ).toBe(true);
    expect(
      sameLocator(createLocator(book.sections[1]!, 0.4), createLocator(book.sections[2]!, 0.4)),
    ).toBe(false);
  });

  it("normalizes annotations when a publication gets new section ids", () => {
    const annotation = normalizeAnnotation(
      {
        ...book,
        sections: book.sections.map((section, index) => ({
          ...section,
          id: `section-${index + 1}`,
          href: `chapter-${index + 1}.xhtml`,
        })),
      },
      {
        id: "note-1",
        label: "第二章",
        note: "继续验证 Locator。",
        locator: {
          kind: "section",
          sectionId: "missing",
          href: "chapter-2.xhtml",
          progression: 0.25,
        },
        createdAt: 1,
        updatedAt: 2,
      },
    );
    expect(annotation.locator.sectionId).toBe("section-2");
    expect(annotation.note).toContain("Locator");
  });
});
