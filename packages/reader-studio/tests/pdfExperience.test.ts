import { describe, expect, it } from "vitest";
import { createLocator, normalizeLocator, sameLocator, type ReaderBook } from "@bcr/reader-core";
import { fitPdfPage } from "../src/reading/usePdfViewport";
import { safePdfLink } from "../src/reading/PdfPageLinks";
import { normalizeReaderProgress } from "../src/state/session-contract";
import { createDemoBook, DEFAULT_READER_SETTINGS, normalizeBookSettings } from "../src/state/model";
import { getReaderState, reader } from "../src/state/store";

const book: ReaderBook = {
  ...createDemoBook(),
  id: "pdf-audit",
  source: { name: "audit.pdf", format: "pdf", mime: "application/pdf", size: 1 },
  sections: [
    {
      id: "page-1",
      order: 0,
      label: "i",
      text: "example",
      kind: "pdf-page",
      pageNumber: 1,
      pageAspectRatio: 0.7,
    },
  ],
};
describe("PDF reading geometry and durable state", () => {
  it("fits both axes without enlarging a portrait page beyond the viewport", () => {
    expect(fitPdfPage(335, 580, 0.707)).toBe(1);
    const landscape = fitPdfPage(720, 140, 0.707);
    expect((720 * landscape) / 0.707).toBeCloseTo(140);
    expect(landscape).toBeLessThan(0.4);
  });
  it("preserves horizontal-only movements through persistence and jump history", () => {
    reader.hydrate([book], {}, DEFAULT_READER_SETTINGS, {}, book.id, {});
    const original = { ...createLocator(book.sections[0]!, 0.25), pageAnchor: { x: 0.3, y: 0.25 } };
    reader.setLocator(original);
    const panned = { ...original, pageAnchor: { x: 0.7, y: 0.25 } };
    reader.setLocator(panned);
    expect(getReaderState().progressByBook[book.id]!.locator.pageAnchor).toEqual(panned.pageAnchor);
    expect(
      normalizeReaderProgress([book], JSON.parse(JSON.stringify(getReaderState().progressByBook)))[
        book.id
      ]!.locator,
    ).toEqual(panned);
    expect(sameLocator(original, panned)).toBe(false);
    reader.seekLocator({ ...original, pageAnchor: { x: 0.5, y: 0.1 } }, undefined, true);
    reader.navigateHistory("back");
    expect(getReaderState().progressByBook[book.id]!.locator).toEqual(panned);
  });
  it("validates page anchors instead of restoring invalid coordinates", () => {
    const locator = createLocator(book.sections[0]!);
    expect(
      normalizeLocator(book, { ...locator, pageAnchor: { x: Infinity, y: 0 } }).pageAnchor,
    ).toBeUndefined();
    expect(normalizeLocator(book, { ...locator, pageAnchor: { x: -1, y: 2 } }).pageAnchor).toEqual({
      x: 0,
      y: 1,
    });
    expect(
      normalizeLocator(createDemoBook(), { ...locator, pageAnchor: { x: 0.5, y: 0.5 } }).pageAnchor,
    ).toBeUndefined();
  });
  it("retains zoom mode and page color independently for each book", () => {
    expect(
      normalizeBookSettings({
        a: { pdfZoomMode: "page", pdfColor: "original" },
        b: { pdfZoom: 2, pdfZoomMode: "custom", pdfColor: "night" },
      }),
    ).toEqual({
      a: { pdfZoomMode: "page", pdfColor: "original" },
      b: { pdfZoom: 2, pdfZoomMode: "custom", pdfColor: "night" },
    });
    expect(normalizeBookSettings({ a: { pdfZoomMode: "broken", pdfColor: "broken" } })).toEqual({
      a: {},
    });
  });
  it("only exposes navigable document URLs", () => {
    expect(safePdfLink("https://example.com/reference")).toBe("https://example.com/reference");
    expect(safePdfLink("mailto:reader@example.com")).toBe("mailto:reader@example.com");
    for (const value of [
      "javascript:alert(1)",
      "data:text/html,test",
      "file:///private",
      "//example.com",
      null,
    ])
      expect(safePdfLink(value)).toBeUndefined();
  });
});

describe("Reader search continuation", () => {
  it("continues beyond 80 matches for both normal and deferred publications", async () => {
    const { searchReaderDetailed } = await import("../src/search/readerSearch");
    const { attachReaderContent, releaseReaderContent } =
      await import("../src/content/readerContent");
    const text = "needle ".repeat(125);
    const sections = [{ ...book.sections[0]!, text }];
    const normal = { ...book, sections };
    const deferred = {
      ...book,
      sections: attachReaderContent(
        sections.map((section) => ({ ...section, contentInfo: { textLength: text.length } })),
        {
          async read() {
            return { text };
          },
        },
      ),
    };
    const runtime = {} as import("../src/runtime/readerRuntimeCore").ReaderRuntime;
    for (const publication of [normal, deferred]) {
      const first = await searchReaderDetailed(runtime, [publication], "needle");
      const more = await searchReaderDetailed(runtime, [publication], "needle", undefined, 160);
      expect(first.hits).toHaveLength(80);
      expect(first.truncated).toBe(true);
      expect(more.hits).toHaveLength(125);
      expect(more.truncated).toBe(false);
      expect(more.hits.slice(0, 80)).toEqual(first.hits);
    }
    releaseReaderContent(deferred);
  });
});
