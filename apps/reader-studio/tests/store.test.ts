import { beforeEach, describe, expect, it } from "vitest";
import { createTextLocator } from "@bcr/reader-core";
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
});
