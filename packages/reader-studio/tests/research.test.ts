import { describe, expect, it } from "vitest";
import { createSearchIndex } from "@bcr/core";
import type { ReaderBook } from "@bcr/reader-core";
import { readerResearchDocuments, resolveResearchRange } from "../src/researchDocuments";

const text = "序文".repeat(7500) + "独特的研究证据" + "结尾".repeat(1000);
const book: ReaderBook = {
  id: "a?&",
  title: "研究资料",
  source: { name: "book.txt", format: "txt", mime: "text/plain", size: 1 },
  sections: [{ id: "section#1", order: 0, label: "长章节", kind: "text", text }],
  tags: [],
  updatedAt: 1,
  importedAt: 1,
};
describe("Reader evidence projections", () => {
  it("covers long chapters and retains exact original ranges after persistence", async () => {
    let raw: string | undefined;
    const persistence = {
      load: async () => raw,
      save: async (value: string) => {
        raw = value;
      },
    };
    const index = createSearchIndex(persistence);
    await index.ready;
    index.replaceSource("reader", readerResearchDocuments(book));
    await index.close();
    const restored = createSearchIndex(persistence);
    await restored.ready;
    const result = restored.search("独特的研究证据")[0]!;
    expect(result).toBeDefined();
    const params = new URL(result.document.route!, "https://example.org").searchParams;
    expect(params.get("book")).toBe(book.id);
    const range = resolveResearchRange(text, params)!;
    expect(range.start).toBeGreaterThan(12000);
    expect(text.slice(range.start, range.end)).toBe(result.document.body);
    expect(resolveResearchRange("changed", params)).toBeUndefined();
    await restored.close();
  });
  it("does not emit split surrogate pairs at chunk boundaries", () => {
    const astral = "🦊".repeat(2000);
    const records = readerResearchDocuments({
      ...book,
      sections: [{ ...book.sections[0]!, text: "a" + astral }],
    });
    for (const record of records) expect(record.body!.isWellFormed()).toBe(true);
  });
});
