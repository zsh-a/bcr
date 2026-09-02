import { describe, expect, it } from "vitest";
import type { ArtifactRef } from "@bcr/core";
import { createDemoBook } from "../src/model";
import { documentFormatForReader, readerBookToDocumentContent } from "../src/document-adapter";

describe("Reader → Document adapter", () => {
  it("projects stable sections, metadata and source lineage", () => {
    const sourceRef: ArtifactRef = {
      id: "reader/source/demo",
      type: "file/publication",
      storage: "opfs",
      format: "text/markdown",
      hash: "demo-hash",
    };
    const book = {
      ...createDemoBook(),
      source: {
        ...createDemoBook().source,
        ref: {
          id: sourceRef.id,
          hash: sourceRef.hash!,
          storage: "opfs" as const,
          mime: "text/markdown",
          size: 4096,
        },
      },
    };
    const content = readerBookToDocumentContent(book, sourceRef, 42);

    expect(content).toMatchObject({
      id: "reader/demo-reading-space",
      format: "markdown",
      sourceName: "reading-space.md",
      sourceRef,
      metadata: { title: book.title, author: book.author, language: book.language },
      provenance: { adapter: "reader.projection", createdAt: 42, sourceHash: "demo-hash" },
    });
    expect(content.blocks).toHaveLength(book.sections.length);
    expect(content.blocks[0]).toMatchObject({
      id: "opening",
      order: 0,
      kind: "paragraph",
      label: "序章 · 把时间还给阅读",
      html: expect.stringContaining("<p>"),
    });
  });

  it("keeps Reader-only binary formats outside Document text extraction", () => {
    expect(documentFormatForReader("cbr")).toBe("unknown");
    expect(documentFormatForReader("mobi")).toBe("unknown");
    expect(documentFormatForReader("azw3")).toBe("unknown");
  });
});
