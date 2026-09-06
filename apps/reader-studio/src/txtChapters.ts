import type { ReaderBook, ReaderSection, ReaderTocItem } from "@bcr/reader-core";

export interface TxtHeading {
  readonly sectionId: string;
  readonly label: string;
}

/** Conservative whole-line rules: prose and bare list numbers are not chapter titles. */
export function txtHeading(line: string): string | undefined {
  const label = line.normalize("NFKC").trim();
  if (!label || label.length > 80 || /[。！？；!?;]/u.test(label)) return;
  if (
    /^第\s*[零〇一二三四五六七八九十百千万两壹贰叁肆伍陆柒捌玖拾佰仟\d]+\s*[章节回卷部篇集](?:\s|[：:、.·—-]|$|[^\s\d]).*$/u.test(
      label,
    )
  )
    return label;
  if (/^(?:chapter|part|book)\s+(?:\d+|[ivxlcdm]+)(?:\b|[.:—-]).*$/iu.test(label)) return label;
  if (/^#{1,3}\s+\S/u.test(label)) return label.replace(/^#{1,3}\s+/u, "");
  if (/^(?:序章|楔子|前言|序言|引子|后记|尾声|终章|番外)(?:\s.*|[：:·—-].*)?$/u.test(label))
    return label;
  return;
}

export function txtToc(headings: readonly TxtHeading[]): ReaderTocItem[] {
  // One isolated heading is too weak to replace paragraph navigation.
  if (headings.length < 2) return [];
  return headings.map(({ sectionId, label }) => ({ id: `txt-toc:${sectionId}`, sectionId, label }));
}
export function inlineTxtToc(sections: readonly ReaderSection[]): ReaderTocItem[] {
  return txtToc(
    sections.flatMap((section) => {
      const label = txtHeading(section.text.split("\n", 1)[0] ?? "");
      return label ? [{ sectionId: section.id, label }] : [];
    }),
  );
}

const chapterIndexes = new WeakMap<
  ReaderBook,
  {
    positions: ReadonlyMap<string, number>;
    chapters: readonly { item: ReaderTocItem; index: number }[];
  }
>();

export function currentTxtChapter(book: ReaderBook, sectionId: string | null) {
  if (book.source.format !== "txt" || !book.toc?.length) return;
  let cached = chapterIndexes.get(book);
  if (!cached) {
    const positions = new Map(book.sections.map((section, index) => [section.id, index]));
    const chapters = book.toc
      .flatMap((item) => {
        const index = positions.get(item.sectionId ?? "");
        return index === undefined ? [] : [{ item, index }];
      })
      .sort((left, right) => left.index - right.index);
    cached = { positions, chapters };
    chapterIndexes.set(book, cached);
  }
  const active = cached.positions.get(sectionId ?? "") ?? -1;
  let low = 0,
    high = cached.chapters.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (cached.chapters[middle]!.index <= active) low = middle + 1;
    else high = middle;
  }
  return cached.chapters[low - 1]?.item;
}
