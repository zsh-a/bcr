import { describe, expect, it } from "vitest";
import { percentageForLocator, createLocator } from "@bcr/reader-core";
import { scanTxt, readTxtRange, searchTxt, TXT_CHUNK_BYTES, validTxtRanges } from "../src/txtIndex";
import { attachTxtSections } from "../src/lazyTxt";
import { loadSectionContent, subscribeSectionContent } from "../src/readerContent";
import { textSections } from "../src/readerMarkup";
import { createDemoBook } from "../src/model";
import { persistBook } from "../src/readerPersistence";

describe("demand-loaded TXT", () => {
  it("evicts by byte budget as well as paragraph count", async () => {
    const blob = new Blob([
      Array.from({ length: 15 }, (_, index) => `${index}${"正文".repeat(50000)}`).join("\n\n"),
    ]);
    const sections = attachTxtSections(blob, await scanTxt(blob));
    for (const section of sections) await loadSectionContent(section);
    const retainedBytes = sections.reduce(
      (total, section) => total + (section.text.length + (section.html?.length ?? 0)) * 2,
      0,
    );
    expect(retainedBytes).toBeGreaterThan(0);
    expect(retainedBytes).toBeLessThanOrEqual(4 * 1024 * 1024);
    expect(sections[0]!.text).toBe("");
    expect(sections[14]!.text).not.toBe("");
  });

  it("keeps paragraph IDs, normalized text lengths and UTF-8 ranges across chunk boundaries", async () => {
    const fixtures = [
      "",
      " \n\n ",
      "\uFEFF 苹果😀\r\n\r\n桃子\r西瓜\n\n结尾 ",
      "甲\n \n乙\n\n丙",
      "a".repeat(TXT_CHUNK_BYTES - 1) + "\r\n\r\n😀\n\n尾",
      "甲".repeat(Math.floor(TXT_CHUNK_BYTES / 3)) + "😀\n\n末段",
    ];
    for (const text of fixtures) {
      const blob = new Blob([text]);
      const ranges = await scanTxt(blob);
      const expected = textSections(text, "txt");
      expect(ranges).toHaveLength(expected.length);
      for (const [index, range] of ranges.entries()) {
        expect(await readTxtRange(blob, range)).toBe(expected[index]!.text);
        expect(range.length).toBe(expected[index]!.text.length);
      }
    }
  });
  it("bounds retained paragraphs and keeps progress and snapshots independent of cache residency", async () => {
    const blob = new Blob([
      Array.from({ length: 300 }, (_, i) => `${i} 正文`.repeat(10)).join("\n\n"),
    ]);
    const sections = attachTxtSections(blob, await scanTxt(blob));
    const book = { ...createDemoBook(), sections };
    const locator = createLocator(sections[150]!, 0.5);
    const before = percentageForLocator(book, locator);
    const snapshot = persistBook(book);
    expect(sections.every((section) => section.text === "")).toBe(true);
    const unpin = subscribeSectionContent(sections[0], () => {});
    for (const section of sections) await loadSectionContent(section);
    expect(sections.filter((section) => section.text).length).toBeLessThanOrEqual(128);
    expect(sections[0]!.text).not.toBe("");
    expect(sections[1]!.text).toBe("");
    expect(percentageForLocator({ ...book }, locator)).toBe(before);
    expect(persistBook(book)).toEqual(snapshot);
    unpin();
    expect(sections.every((section) => section.text === "")).toBe(true);
  });
  it("searches unloaded paragraphs with original offsets and supports abort", async () => {
    const blob = new Blob(["序言\n\n  Ａ😀苹果 苹果\n\n结尾"]);
    const ranges = await scanTxt(blob);
    const hits = await searchTxt(blob, ranges, "book", "苹果");
    expect(hits.map((hit) => [hit.sectionId, hit.matchStart])).toEqual([
      ["section-2", 3],
      ["section-2", 6],
    ]);
    const controller = new AbortController();
    controller.abort();
    await expect(scanTxt(blob, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    await expect(
      searchTxt(blob, ranges, "book", "不存在", controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(
      validTxtRanges(
        [{ id: "section-1", textRange: { start: 0, end: blob.size + 1, length: 2 } }],
        blob.size,
      ),
    ).toBe(false);
  });
});
