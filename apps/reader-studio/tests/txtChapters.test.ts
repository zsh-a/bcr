import { describe, expect, it } from "vitest";
import { inlineTxtToc, txtHeading, currentTxtChapter } from "../src/txtChapters";
import { scanTxtIndex, TXT_CHUNK_BYTES } from "../src/txtIndex";
import { textSections } from "../src/readerMarkup";
import { createDemoBook } from "../src/model";

describe("TXT chapter recognition", () => {
  it("recognizes conventional complete title lines without treating sentences/lists as chapters", () => {
    for (const line of [
      "第一章 初见",
      "第１２回 风雪",
      "第二卷",
      "Chapter IV: Arrival",
      "PART 2",
      "## Heading",
      "楔子",
      "后记",
    ])
      expect(txtHeading(line), line).toBeTruthy();
    for (const line of [
      "1. 买牛奶",
      "在第一章中我们讨论过。",
      "第一章介绍了这个问题。",
      "Chapter information",
      "正文".repeat(50),
    ])
      expect(txtHeading(line), line).toBeUndefined();
    expect(inlineTxtToc(textSections("第一章\n\n普通内容", "txt"))).toEqual([]);
  });
  it("produces the same TOC for inline and streamed UTF-8 input without changing paragraph identities", async () => {
    const raw =
      "\uFEFF\n  第一章 初见\r\n正文😀\r\n\r\n" +
      "甲".repeat(TXT_CHUNK_BYTES) +
      "\r\n\r\n第二章 重逢\n\n结束";
    const sections = textSections(raw, "txt");
    const index = await scanTxtIndex(new Blob([raw]));
    expect(index.toc).toEqual(inlineTxtToc(sections));
    expect(index.toc.map((item) => item.sectionId)).toEqual(["section-1", "section-3"]);
    expect(index.ranges.map((range) => range.length)).toEqual(
      sections.map((section) => section.text.length),
    );
  });
  it("identifies the current chapter independently of paragraph loading boundaries", () => {
    const sections = textSections(
      Array.from({ length: 100 }, (_, i) =>
        i === 0 ? "第一章 开始" : i === 45 ? "第二章 继续" : `第${i}段普通正文`,
      ).join("\n\n"),
      "txt",
    );
    const book = {
      ...createDemoBook(),
      source: { ...createDemoBook().source, format: "txt" as const },
      sections,
      toc: inlineTxtToc(sections),
    };
    expect(currentTxtChapter(book, "section-70")?.label).toBe("第二章 继续");
  });
});
