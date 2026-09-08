import type { ReaderBook, ReaderSection } from "@bcr/reader-core";

export interface TxtPageCursor {
  readonly section: number;
  readonly offset: number;
}
export interface TxtMeasuredParagraph {
  readonly text: string;
  /** UTF-16 offsets of line starts, followed by the exclusive text end. */
  readonly breaks: readonly number[];
  readonly heading: boolean;
}
export interface TxtPageFragment {
  readonly section: ReaderSection;
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly gap: number;
  readonly total: number;
  readonly heading: boolean;
}
export interface TxtPage {
  readonly start: TxtPageCursor;
  readonly end: TxtPageCursor;
  readonly fragments: readonly TxtPageFragment[];
}
export interface TxtPageGeometry {
  readonly height: number;
  readonly lineHeight: number;
  readonly paragraphGap: number;
}

export function compareTxtCursor(a: TxtPageCursor, b: TxtPageCursor): number {
  return a.section - b.section || a.offset - b.offset;
}

/** Source paragraphs are the loading unit; source line boundaries are the paging unit. */
export class TxtPageLayout {
  private readonly chapters: Set<number>;
  constructor(
    private readonly book: ReaderBook,
    private readonly geometry: TxtPageGeometry,
    private readonly measure: (section: number) => Promise<TxtMeasuredParagraph>,
  ) {
    const ids = new Set(book.toc?.map((item) => item.sectionId));
    this.chapters = new Set(
      book.sections.flatMap((section, index) => (ids.has(section.id) ? [index] : [])),
    );
  }

  async align(cursor: TxtPageCursor): Promise<TxtPageCursor> {
    const section = Math.max(0, Math.min(this.book.sections.length - 1, cursor.section));
    const paragraph = await this.measure(section);
    const offset = Math.max(0, Math.min(paragraph.text.length - 1, cursor.offset));
    return { section, offset: paragraph.breaks[this.lineAt(paragraph.breaks, offset)] ?? 0 };
  }

  async next(start: TxtPageCursor): Promise<TxtPage | undefined> {
    const fragments: TxtPageFragment[] = [];
    let cursor = start;
    let used = 0;
    while (cursor.section < this.book.sections.length) {
      if (fragments.length && cursor.offset === 0 && this.chapters.has(cursor.section)) break;
      const paragraph = await this.measure(cursor.section);
      const line = this.lineAt(paragraph.breaks, cursor.offset);
      const gap = fragments.length ? this.gapAfter(fragments.at(-1)!.heading) : 0;
      const room = this.linesThatFit(used + gap, fragments.length === 0);
      const count = Math.min(paragraph.breaks.length - 1 - line, room);
      if (count <= 0) break;
      const end = paragraph.breaks[line + count]!;
      fragments.push(this.fragment(cursor.section, paragraph, cursor.offset, end, gap));
      used += gap + count * this.geometry.lineHeight;
      cursor =
        end >= paragraph.text.length
          ? { section: cursor.section + 1, offset: 0 }
          : { section: cursor.section, offset: end };
      if (this.linesThatFit(used, false) === 0) break;
    }
    return fragments.length ? { start, end: cursor, fragments } : undefined;
  }

  async previous(end: TxtPageCursor): Promise<TxtPage | undefined> {
    const fragments: TxtPageFragment[] = [];
    let cursor = end;
    let used = 0;
    while (cursor.section > 0 || cursor.offset > 0) {
      if (fragments.length && cursor.offset === 0 && this.chapters.has(cursor.section)) break;
      const index = cursor.offset === 0 ? cursor.section - 1 : cursor.section;
      const paragraph = await this.measure(index);
      const limit = cursor.offset === 0 ? paragraph.text.length : cursor.offset;
      const lineEnd = this.lineAt(paragraph.breaks, limit);
      const gap = fragments.length ? this.gapAfter(paragraph.heading) : 0;
      const count = Math.min(lineEnd, this.linesThatFit(used + gap, fragments.length === 0));
      if (count <= 0) break;
      const start = paragraph.breaks[lineEnd - count]!;
      if (fragments.length) fragments[0] = { ...fragments[0]!, gap };
      fragments.unshift(this.fragment(index, paragraph, start, limit, 0));
      used += gap + count * this.geometry.lineHeight;
      cursor = { section: index, offset: start };
      if (this.linesThatFit(used, false) === 0) break;
    }
    return fragments.length ? { start: cursor, end, fragments } : undefined;
  }

  private fragment(
    index: number,
    paragraph: TxtMeasuredParagraph,
    start: number,
    end: number,
    gap: number,
  ): TxtPageFragment {
    const slice = paragraph.text.slice(start, end);
    // Do not keep an oversized source string alive through a small cached slice.
    const text = paragraph.text.length > 24000 ? Array.from(slice).join("") : slice;
    return {
      section: this.book.sections[index]!,
      start,
      end,
      text,
      gap,
      total: paragraph.text.length,
      heading: paragraph.heading,
    };
  }
  private gapAfter(heading: boolean): number {
    return heading ? this.geometry.lineHeight : this.geometry.paragraphGap;
  }
  private linesThatFit(used: number, empty: boolean): number {
    return Math.max(
      empty ? 1 : 0,
      Math.floor((this.geometry.height - used + 0.01) / this.geometry.lineHeight),
    );
  }
  private lineAt(breaks: readonly number[], offset: number): number {
    let low = 0,
      high = breaks.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (breaks[mid]! <= offset) low = mid;
      else high = mid - 1;
    }
    return low;
  }
}
