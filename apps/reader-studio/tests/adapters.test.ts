import { describe, expect, it } from "vitest";
import {
  formatForFile,
  mapPdfOutlineToToc,
  openReaderContentPackage,
  safeUrl,
  sanitizeInlineStyle,
} from "../src/adapters";
import { createDocumentContentPackage, createDocumentTranslationPackage } from "@bcr/document-core";
import {
  READER_FORMAT_CATALOG,
  readerAcceptAttribute,
  readerFormatDescriptor,
} from "@bcr/reader-core";

describe("reader format catalog", () => {
  it("keeps common extensions and MIME fallbacks in one registry", () => {
    expect(formatForFile({ name: "notes.mdown", type: "" })).toBe("markdown");
    expect(formatForFile({ name: "report", type: "application/pdf" })).toBe("pdf");
    expect(formatForFile({ name: "chapter.zip", type: "application/zip" })).toBe("cbz");
    expect(
      formatForFile({
        name: "draft.bin",
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    ).toBe("docx");
    expect(formatForFile({ name: "novel.mobi", type: "" })).toBe("mobi");
  });

  it("exposes only native formats to file inputs", () => {
    const accept = readerAcceptAttribute();
    expect(accept).toContain(".docx");
    expect(accept).toContain("application/pdf");
    expect(accept).not.toContain(".mobi");
    expect(READER_FORMAT_CATALOG.filter((item) => item.support === "native")).toHaveLength(8);
    expect(readerFormatDescriptor("docx")).toMatchObject({
      label: "DOCX",
      support: "native",
    });
  });

  it("keeps publication typography but strips executable and layout CSS", () => {
    expect(
      sanitizeInlineStyle(
        "font-weight: 700; color: #234; margin: 1em; position: fixed; background-image: url(https://evil.test/x)",
      ),
    ).toBe("font-weight: 700; color: #234; margin: 1em");
    expect(sanitizeInlineStyle("behavior: url(#default#time); width: expression(alert(1))")).toBe(
      undefined,
    );
  });

  it("keeps EPUB-relative URLs while rejecting executable protocols", () => {
    expect(safeUrl("chapter-2.xhtml#note")).toBe("chapter-2.xhtml#note");
    expect(safeUrl("../notes/endnotes.xhtml")).toBe("../notes/endnotes.xhtml");
    expect(safeUrl("javascript:alert(1)")).toBe("#");
  });

  it("hydrates a Reader book from the shared document content contract", () => {
    const content = createDocumentContentPackage({
      id: "content-1",
      format: "markdown",
      sourceName: "notes.md",
      metadata: { author: "Ada" },
      adapter: "markdown.extract",
      blocks: [
        { id: "title", kind: "heading", label: "Field notes", text: "# Field notes" },
        { id: "body", label: "正文", text: "A local-first note." },
      ],
    });
    const translation = createDocumentTranslationPackage({
      id: "translation-1",
      sourceContentId: content.id,
      sourceName: content.sourceName,
      format: content.format,
      targetLanguage: "zh-Hans",
      adapter: "review.manual",
      blocks: content.blocks.map((block) => ({
        ...block,
        translatedText: block.id === "title" ? "现场笔记" : "本地优先的笔记。",
        status: "translated" as const,
      })),
    });
    const book = openReaderContentPackage(
      new File(["source"], "notes.md"),
      "book-1",
      content,
      translation,
    );
    expect(book).toMatchObject({ id: "book-1", title: "Field notes", author: "Ada" });
    expect(book.sections.map((section) => section.id)).toEqual(["title", "body"]);
    expect(book.sections[0]).toMatchObject({
      kind: "text",
      label: "Field notes",
      text: "现场笔记",
    });
  });

  it("maps nested PDF outlines to page sections and keeps broken targets visible", async () => {
    const toc = await mapPdfOutlineToToc(
      [
        {
          title: "  第一章\n起点  ",
          dest: "chapter-1",
          items: [
            { title: "没有目标", dest: null },
            { title: "第二节", dest: [{ num: 12, gen: 0 }] },
          ],
        },
        { title: "断开的书签", dest: "missing" },
        { title: "", items: [{ title: "保留子节点", dest: [{ num: 20, gen: 0 }] }] },
      ],
      async (destination) => {
        if (destination === "chapter-1") return 2;
        if (destination === "missing") throw new Error("missing destination");
        if (Array.isArray(destination)) return 7;
        return undefined;
      },
    );

    expect(toc).toMatchObject([
      {
        id: "pdf-toc-root.1",
        label: "第一章 起点",
        sectionId: "page-3",
        children: [
          { id: "pdf-toc-root.1.1", label: "没有目标" },
          { id: "pdf-toc-root.1.2", label: "第二节", sectionId: "page-8" },
        ],
      },
      { id: "pdf-toc-root.2", label: "断开的书签" },
      { id: "pdf-toc-root.3.1", label: "保留子节点", sectionId: "page-8" },
    ]);
  });
});
