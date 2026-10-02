import { describe, expect, it } from "vitest";
import type { ReaderBook, ReaderSection } from "@bcr/reader-core";
import {
  currentReaderTocItem,
  resolveReaderInternalLink,
  resolveReaderTocTarget,
} from "../src/navigation/navigation";

const firstSection: ReaderSection = {
  id: "epub:OPS/text/chapter 1.xhtml",
  order: 0,
  label: "第一章",
  kind: "text",
  text: "第一章",
  href: "OPS/text/chapter 1.xhtml",
};

const book: ReaderBook = {
  id: "links",
  title: "Links",
  source: { name: "links.epub", format: "epub", mime: "application/epub+zip", size: 1 },
  sections: [
    firstSection,
    {
      id: "epub:OPS/notes/endnotes.xhtml",
      order: 1,
      label: "注释",
      kind: "text",
      text: "注释",
      href: "OPS/notes/endnotes.xhtml",
    },
  ],
  importedAt: 1,
  updatedAt: 1,
  tags: ["EPUB"],
};

describe("Reader publication links", () => {
  it("resolves same-section fragments", () => {
    expect(resolveReaderInternalLink(book, firstSection, "#idea%201")).toEqual({
      sectionId: firstSection.id,
      fragment: "idea 1",
    });
  });

  it("resolves encoded cross-section paths relative to the source chapter", () => {
    expect(
      resolveReaderInternalLink(book, firstSection, "../notes/%65ndnotes.xhtml?view=reader#note-2"),
    ).toEqual({
      sectionId: "epub:OPS/notes/endnotes.xhtml",
      fragment: "note-2",
    });
  });

  it("resolves the bare relative paths commonly emitted by EPUB generators", () => {
    expect(resolveReaderInternalLink(book, firstSection, "../notes/endnotes.xhtml#note-3")).toEqual(
      {
        sectionId: "epub:OPS/notes/endnotes.xhtml",
        fragment: "note-3",
      },
    );
  });

  it("leaves external and unavailable publication links to the browser", () => {
    expect(resolveReaderInternalLink(book, firstSection, "https://example.com/chapter")).toBe(
      undefined,
    );
    expect(resolveReaderInternalLink(book, firstSection, "mailto:reader@example.com")).toBe(
      undefined,
    );
    expect(resolveReaderInternalLink(book, firstSection, "missing.xhtml#note")).toBe(undefined);
  });
  it("resolves indexed TOC targets by section id or encoded paths, retaining fragment anchors", () => {
    expect(
      resolveReaderTocTarget(book, {
        id: "first",
        label: "第一章",
        href: "OPS/text/chapter%201.xhtml#idea%201",
      }),
    ).toEqual({ sectionId: firstSection.id, fragment: "idea 1" });
    expect(
      resolveReaderTocTarget(book, {
        id: "second",
        label: "注释",
        sectionId: book.sections[1]!.id,
      }),
    ).toEqual({ sectionId: book.sections[1]!.id });
    expect(
      resolveReaderTocTarget(book, { id: "missing", label: "不可读", href: "missing.xhtml" }),
    ).toBeUndefined();
  });
  it("rebuilds positions for a new publication snapshot while preserving TOC boundary semantics", () => {
    const items = [
      { id: "toc-one", label: "第一章", sectionId: firstSection.id },
      { id: "toc-two", label: "注释", sectionId: book.sections[1]!.id },
    ];
    expect(currentReaderTocItem(book, items, book.sections[1]!.id)?.id).toBe("toc-two");
    const reordered = { ...book, sections: [...book.sections].reverse() };
    expect(currentReaderTocItem(reordered, items, firstSection.id)?.id).toBe("toc-one");
    expect(currentReaderTocItem(book, items, "missing")).toBeUndefined();
  });
});
