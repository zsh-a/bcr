import { beforeEach, describe, expect, it } from "vitest";
import { createLocator, createTextLocator, type ReaderBook } from "@bcr/reader-core";
import { createDemoBook, DEFAULT_READER_SETTINGS } from "../src/model";
import { getReaderState, reader } from "../src/store";

describe("Reader annotation anchors", () => {
  const book = createDemoBook();

  beforeEach(() => {
    reader.hydrate([book], {}, DEFAULT_READER_SETTINGS, { [book.id]: [] }, book.id, {
      [book.id]: [],
    });
  });

  it("keeps a TextQuote locator when a note is attached to a selection", () => {
    const section = book.sections[1]!;
    const locator = createTextLocator(section, 0, 8);
    reader.addAnnotation("记录这段内容", locator);

    const annotation = getReaderState().annotationsByBook[book.id]?.[0];
    expect(annotation).toMatchObject({
      note: "记录这段内容",
      locator: {
        sectionId: section.id,
        textAnchor: { exact: section.text.slice(0, 8), start: 0, end: 8 },
      },
    });
  });

  it("emits an explicit navigation signal even when reopening the same section", () => {
    const before = getReaderState().navigationSequence;
    reader.openBook(book.id, book.sections[0]!.id);
    expect(getReaderState().navigationSequence).toBe(before + 1);
  });

  it("updates the reading font preferences in the shared settings state", () => {
    reader.setSettings({ fontSize: 22, fontFamily: "kai", latinFontFamily: "mono" });

    expect(getReaderState().settings).toMatchObject({
      fontSize: 22,
      fontFamily: "kai",
      latinFontFamily: "mono",
    });
  });

  it("merges a missing durable book without replacing the live projection", () => {
    const recovered = {
      ...createDemoBook(),
      id: "reader-recovered-book",
      title: "从 SQLite 找回的图书",
    };

    const added = reader.reconcileLibrary([book, recovered], {}, {}, recovered.id, {}, true);

    expect(added.map((item) => item.id)).toEqual([recovered.id]);
    expect(getReaderState().library).toHaveLength(2);
    expect(getReaderState().library[0]).toBe(book);
    expect(getReaderState().activeBookId).toBe(recovered.id);
  });

  it("does not suppress chapter-local movement in books with many sections", () => {
    const sections = Array.from({ length: 100 }, (_, index) => ({
      id: `section-${index}`,
      order: index,
      label: `第 ${index + 1} 章`,
      kind: "text" as const,
      text: "章节正文".repeat(100),
    }));
    const longBook: ReaderBook = { ...book, id: "long-book", sections };
    reader.hydrate([longBook], {}, DEFAULT_READER_SETTINGS, {}, longBook.id);

    reader.setLocator(createLocator(sections[50]!, 0.1));
    reader.setLocator(createLocator(sections[50]!, 0.11));

    expect(getReaderState().progressByBook[longBook.id]?.locator.progression).toBeCloseTo(0.11);
  });

  it("upgrades a ratio-only position to a text anchor", () => {
    const section = book.sections[1]!;
    reader.setLocator(createLocator(section, 0.4));
    reader.setLocator(createTextLocator(section, 4, 16));

    expect(getReaderState().progressByBook[book.id]?.locator.textAnchor).toBeDefined();
  });
});
