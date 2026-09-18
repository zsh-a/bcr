import { describe, expect, it } from "vitest";
import { createTextLocator } from "@bcr/reader-core";
import { createDemoBook } from "../src/model";
import { captureReaderSelection } from "../src/readerCapture";
import { resolveReaderCitation } from "../src/researchDocuments";
import { withTextCitation } from "@bcr/core";

describe("Reader selection capture", () => {
  it("keeps the second occurrence and its original Unicode offsets on return", () => {
    const text = "序言。重复文字 é😀。中间文字。重复文字 é😀。结尾。";
    const section = { id: "body", order: 0, label: "正文", kind: "text" as const, text };
    const book = { ...createDemoBook(), sections: [section] };
    const start = text.lastIndexOf("重复文字");
    const end = start + "重复文字 é😀".length;
    const captured = captureReaderSelection(book, createTextLocator(section, start, end));
    const params = new URL(
      withTextCitation(captured.document.route!, captured.citation),
      "https://local.test",
    ).searchParams;
    expect(resolveReaderCitation(book.id, section, params)).toMatchObject({
      status: "exact",
      hit: { start, end },
    });
  });
  it("rejects stale text instead of collecting a different passage", () => {
    const book = createDemoBook();
    const section = book.sections[0]!;
    const locator = createTextLocator(section, 0, 10);
    expect(() =>
      captureReaderSelection({ ...book, sections: [{ ...section, text: "changed" }] }, locator),
    ).toThrow("已变化");
  });
});
