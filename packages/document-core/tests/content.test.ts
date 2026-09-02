import { describe, expect, it } from "vitest";
import {
  createDocumentContentPackage,
  decodeDocumentContentPackage,
  documentContentStats,
  documentContentText,
} from "../src";

describe("document content package", () => {
  it("normalizes adapter blocks and exposes portable text statistics", () => {
    const content = createDocumentContentPackage({
      id: "content-book",
      format: "markdown",
      sourceName: "  book.md  ",
      metadata: { title: "  A\r\nBook ", language: " zh-Hans " },
      adapter: "markdown.extract",
      createdAt: 42,
      blocks: [
        {
          id: "  intro ",
          kind: "heading",
          label: "  Intro ",
          text: " first line\r\nsecond line ",
          pageNumber: 0,
          geometry: { x: -10, y: 20, width: 130, height: 40, rotation: 90 },
        },
        { text: "第二段" },
      ],
    });

    expect(content).toMatchObject({
      version: 1,
      id: "content-book",
      sourceName: "book.md",
      metadata: { title: "A\nBook", language: "zh-Hans" },
      provenance: { adapter: "markdown.extract", createdAt: 42 },
    });
    expect(content.blocks).toEqual([
      {
        id: "intro",
        order: 0,
        kind: "heading",
        label: "Intro",
        text: "first line\nsecond line",
        pageNumber: 1,
        geometry: { x: 0, y: 20, width: 100, height: 40, rotation: 90 },
      },
      { id: "block-2", order: 1, kind: "paragraph", label: "Block 2", text: "第二段" },
    ]);
    expect(documentContentText(content)).toBe("first line\nsecond line\n\n第二段");
    expect(documentContentStats(content)).toEqual({
      blockCount: 2,
      textBlockCount: 2,
      characterCount: 27,
      wordCount: 5,
      pageCount: 1,
    });
  });

  it("migrates the extractor sections shape, including pre-contract cached artifacts", () => {
    const legacy = decodeDocumentContentPackage({
      version: 1,
      format: "txt",
      sourceName: "Legacy Book.txt",
      sections: [
        { id: "section-1", order: 19, label: "One", text: "hello" },
        { id: "section-2", order: 20, label: "Two", text: "world" },
      ],
    });

    expect(legacy).toBeDefined();
    expect(legacy?.id).toBe("document-legacy-legacy-book-txt");
    expect(legacy?.provenance.adapter).toBe("legacy.extract");
    expect(legacy?.blocks.map((block) => block.order)).toEqual([0, 1]);
    expect(legacy?.blocks.map((block) => block.text)).toEqual(["hello", "world"]);
  });

  it("rejects malformed packages without throwing", () => {
    expect(decodeDocumentContentPackage(null)).toBeUndefined();
    expect(decodeDocumentContentPackage({ version: 2 })).toBeUndefined();
    expect(
      decodeDocumentContentPackage({
        version: 1,
        id: "bad",
        format: "txt",
        sourceName: "bad.txt",
        blocks: [{ id: "x", text: 1 }],
      }),
    ).toBeUndefined();
  });

  it("makes duplicate block IDs deterministic for translation and search", () => {
    const content = createDocumentContentPackage({
      id: "duplicate-blocks",
      format: "txt",
      sourceName: "duplicate.txt",
      adapter: "test",
      blocks: [
        { id: "same", text: "first" },
        { id: "same", text: "second" },
        { id: "same-2", text: "already occupied" },
        { id: "same", text: "third" },
      ],
    });

    expect(content.blocks.map((block) => block.id)).toEqual([
      "same",
      "same-2",
      "same-2-2",
      "same-3",
    ]);
    const decoded = decodeDocumentContentPackage(content);
    expect(decoded?.blocks.map((block) => block.id)).toEqual(
      content.blocks.map((block) => block.id),
    );
  });
});
