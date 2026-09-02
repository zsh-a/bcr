import { describe, expect, it } from "vitest";
import { formatForFile, openReaderContentPackage, sanitizeInlineStyle } from "../src/adapters";
import { createDocumentContentPackage } from "@bcr/document-core";
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
    const book = openReaderContentPackage(new File(["source"], "notes.md"), "book-1", content);
    expect(book).toMatchObject({ id: "book-1", title: "Field notes", author: "Ada" });
    expect(book.sections.map((section) => section.id)).toEqual(["title", "body"]);
    expect(book.sections[0]).toMatchObject({ kind: "text", label: "Field notes" });
  });
});
