import type { ReaderBook, ReaderSection, ReaderTocItem } from "@bcr/reader-core";

export interface TxtHeading {
  readonly sectionId: string;
  readonly label: string;
}

const NUMBER = "(?:[0-9]+|[ivxlcdm]+|[零〇一二三四五六七八九十百千万两壹贰叁肆伍陆捌玖拾佰仟]+)";
const BODY_LIKE = /^(?:介绍|说明|讲述|讨论|内容|本章|这一章|我们|在|是|的|将|从|关于|本文|本节)/u;
const SPECIAL_HEADING =
  /^(?:序|序章|楔子|前言|序言|引子|后记|尾声|终章|番外(?:篇|章)?|外传|附录)(?:\s*(?:[0-9]+|[一二三四五六七八九十百千万]+))?(?:\s*[：:、.．·—–-].*|\s+.*)?$/u;
const ENGLISH_HEADING = new RegExp(
  `^(?:chapter|part|book|volume|section)\\s+#?\\s*${NUMBER}(?:$|[\\s：:、.．·—–-].*)$`,
  "iu",
);

function cleanHeadingLine(line: string): string {
  return line
    .normalize("NFKC")
    .replace(/\uFEFF/gu, "")
    .trim()
    .replace(/^[【『「[]\s*/u, "")
    .replace(/\s*[】』」\]]$/u, "")
    .replace(/(章|节|回|卷|部|篇|集|册)\s*[】』」\]]/u, "$1 ")
    .replace(/\s+#+$/u, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function numberedChineseHeading(label: string): boolean {
  const match = new RegExp(`^第\\s*${NUMBER}\\s*(?:章|节|回|卷|部|篇|集|册)(.*)$`, "iu").exec(
    label,
  );
  if (match === null) return false;
  const suffix = match[1]?.trim() ?? "";
  if (suffix.length === 0) return true;
  if (/^[：:、.．·—–,，-]/u.test(suffix)) return true;
  // A small no-space title such as “第一章初见” is common in downloaded novels.
  // Keep obvious prose (“第一章介绍了……”) out of the TOC.
  return suffix.length <= 24 && !BODY_LIKE.test(suffix) && !/[。！？；!?;]/u.test(suffix);
}

function volumeHeading(label: string): boolean {
  const match =
    /^(?:卷|部)\s*(?:[0-9]+|[零〇一二三四五六七八九十百千万两壹贰叁肆伍陆捌玖拾佰仟]+)(.*)$/iu.exec(
      label,
    );
  if (match === null) return false;
  const suffix = match[1]?.trim() ?? "";
  return (
    suffix.length === 0 ||
    /^[：:、.．·—–,，-]/u.test(suffix) ||
    (suffix.length <= 24 && !BODY_LIKE.test(suffix))
  );
}

/**
 * Return a title only for a whole-line, high-confidence chapter candidate.
 * TXT files frequently mix full-width punctuation, Chinese numerals, and
 * English chapter labels, so normalization happens before the rules run.
 */
export function txtHeading(line: string): string | undefined {
  const label = cleanHeadingLine(line);
  if (!label || label.length > 80 || /[。！？；!?;]/u.test(label)) return;
  if (/^#{1,3}\s+\S/u.test(label)) {
    const markdown = label.replace(/^#{1,3}\s+/u, "").trim();
    return markdown.length > 0 && markdown.length <= 76 ? markdown : undefined;
  }
  if (numberedChineseHeading(label) || volumeHeading(label) || ENGLISH_HEADING.test(label)) {
    return label;
  }
  if (SPECIAL_HEADING.test(label)) return label;
  return;
}

/** Find a heading in the short preview retained by both eager and lazy TXT paths. */
export function txtHeadingFromText(text: string): string | undefined {
  let inspected = 0;
  const preview = text.slice(0, 1_024).replace(/\r\n?/gu, "\n");
  for (const line of preview.split("\n")) {
    if (!line.trim()) continue;
    if (inspected++ >= 6) break;
    const label = txtHeading(line);
    if (label) return label;
  }
  return;
}

export function txtToc(headings: readonly TxtHeading[]): ReaderTocItem[] {
  // One isolated heading is too weak to replace paragraph navigation. Remove
  // repeated callbacks as a guard for streamed previews crossing a chunk.
  const unique = headings.filter(
    (heading, index) =>
      headings.findIndex((item) => item.sectionId === heading.sectionId) === index,
  );
  if (unique.length < 2) return [];
  return unique.map(({ sectionId, label }) => ({ id: `txt-toc:${sectionId}`, sectionId, label }));
}

export function inlineTxtToc(sections: readonly ReaderSection[]): ReaderTocItem[] {
  return txtToc(
    sections.flatMap((section) => {
      const label = txtHeadingFromText(section.text);
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
