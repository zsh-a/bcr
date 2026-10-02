import { describe, expect, it } from "vitest";
import { createDemoBook } from "../src/state/model";
import {
  TxtPageLayout,
  compareTxtCursor,
  type TxtPageCursor,
} from "../src/pagination/txtPageLayout";

function fixture(gap = 0) {
  const book = {
    ...createDemoBook(),
    toc: undefined,
    sections: Array.from({ length: 100 }, (_, index) => ({
      id: `s${index}`,
      order: index,
      kind: "text" as const,
      label: `${index}`,
      text: `${index.toString().padStart(2, "0")}${"正文".repeat(24)}`,
    })),
  };
  const measure = async (index: number) => {
    const text = book.sections[index]!.text;
    return { text, breaks: Array.from({ length: 6 }, (_, line) => line * 10), heading: false };
  };
  return {
    book,
    layout: new TxtPageLayout(book, { height: 70, lineHeight: 10, paragraphGap: gap }, measure),
    measure,
  };
}

describe("TXT source-boundary pagination", () => {
  it("keeps a three-line paragraph together when a split would leave one line", async () => {
    const { book } = fixture();
    const short = {
      ...book,
      sections: book.sections
        .slice(0, 2)
        .map((section) => ({ ...section, text: section.text.slice(0, 30) })),
    };
    const layout = new TxtPageLayout(
      short,
      { height: 50, lineHeight: 10, paragraphGap: 0 },
      async (index) => ({
        text: short.sections[index]!.text,
        breaks: [0, 10, 20, 30],
        heading: false,
      }),
    );
    expect((await layout.next({ section: 0, offset: 0 }))?.end).toEqual({ section: 1, offset: 0 });
    expect((await layout.previous({ section: 2, offset: 0 }))?.start).toEqual({
      section: 1,
      offset: 0,
    });
  });
  it("fills pages across loading boundaries without omissions or duplicate text", async () => {
    const { book, layout } = fixture();
    let cursor = { section: 0, offset: 0 };
    const text: string[] = [];
    let pages = 0;
    while (true) {
      const page = await layout.next(cursor);
      if (!page) break;
      expect(page.start).toEqual(cursor);
      expect(compareTxtCursor(page.end, cursor)).toBeGreaterThan(0);
      const value = page.fragments.map((fragment) => fragment.text).join("");
      expect(value.length).toBeLessThanOrEqual(70);
      for (const fragment of page.fragments) {
        // Five-line paragraphs never leave a lone line at a page boundary.
        if (fragment.start > 0 || fragment.end < fragment.total)
          expect(fragment.text.length).toBeGreaterThanOrEqual(20);
      }
      text.push(value);
      cursor = page.end;
      pages++;
    }
    expect(pages).toBeGreaterThanOrEqual(Math.ceil(5000 / 70));
    expect(text.join("")).toBe(book.sections.map((section) => section.text).join(""));
  });
  it("reconstructs preceding pages locally from an exact continuation cursor", async () => {
    const { book, layout } = fixture();
    let cursor = { section: 65, offset: 30 };
    const initial = cursor;
    const text: string[] = [];
    while (true) {
      const page = await layout.previous(cursor);
      if (!page) break;
      expect(page.end).toEqual(cursor);
      expect(compareTxtCursor(page.start, cursor)).toBeLessThan(0);
      text.unshift(page.fragments.map((fragment) => fragment.text).join(""));
      cursor = page.start;
    }
    expect(text.join("")).toBe(
      book.sections
        .slice(0, initial.section)
        .map((section) => section.text)
        .join("") + book.sections[initial.section]!.text.slice(0, initial.offset),
    );
    expect(await layout.align({ section: 65, offset: 37 })).toEqual(initial);
  });
  it("keeps chapter breaks while removing technical paragraph-group breaks", async () => {
    const { book, measure } = fixture();
    const layout = new TxtPageLayout(
      { ...book, toc: [{ id: "chapter", label: "第二章", sectionId: "s32" }] },
      { height: 70, lineHeight: 10, paragraphGap: 0 },
      measure,
    );
    const end = await layout.next({ section: 31, offset: 20 });
    expect(end?.end).toEqual({ section: 32, offset: 0 });
    expect(end?.fragments).toHaveLength(1);
    const previous = await layout.previous({ section: 32, offset: 30 });
    expect(previous?.start).toEqual({ section: 32, offset: 0 });
    const chapter = await layout.next({ section: 32, offset: 0 });
    expect(chapter?.end).toEqual({ section: 33, offset: 20 });
  });
  it("fits spaced paragraphs and trims the leading page gap in either direction", async () => {
    const { layout } = fixture(13);
    const cursors: TxtPageCursor[] = [
      { section: 2, offset: 20 },
      { section: 33, offset: 0 },
    ];
    for (const cursor of cursors) {
      for (const page of [await layout.next(cursor), await layout.previous(cursor)]) {
        expect(page).toBeDefined();
        expect(page!.fragments[0]!.gap).toBe(0);
        const height = page!.fragments.reduce(
          (height, fragment) => height + fragment.gap + (fragment.end - fragment.start),
          0,
        );
        expect(height).toBeLessThanOrEqual(70);
      }
    }
  });
});
