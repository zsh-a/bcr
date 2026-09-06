import { textVersion } from "@bcr/core";
import { makeSnippet, searchTextRanges, type SearchHit } from "@bcr/reader-core";

export interface TxtRange {
  readonly start: number;
  readonly end: number;
  readonly length: number;
}
export interface TxtSearchHit extends SearchHit {
  readonly excerpt: string;
  readonly excerptStart: number;
  readonly version: string;
}
export const TXT_CHUNK_BYTES = 256 * 1024;

/** Match textSections' CR/LF normalization, blank-line splitting and trim without retaining prose. */
export async function scanTxt(file: Blob, signal?: AbortSignal): Promise<TxtRange[]> {
  const ranges: TxtRange[] = [];
  const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
  let start = 0,
    firstNewline = 0,
    newlines = 0,
    previousCR = false;
  let length = 0,
    whitespace = 0;
  const append = (value: string) => {
    for (const character of value) {
      if (/\s/u.test(character)) {
        if (length > 0) whitespace += character.length;
      } else {
        length += whitespace + character.length;
        whitespace = 0;
      }
    }
  };
  const finish = (end: number) => {
    if (length > 0) ranges.push({ start, end, length });
    length = 0;
    whitespace = 0;
  };
  for (let offset = 0; offset < file.size; offset += TXT_CHUNK_BYTES) {
    signal?.throwIfAborted();
    const bytes = new Uint8Array(await file.slice(offset, offset + TXT_CHUNK_BYTES).arrayBuffer());
    let from = 0;
    for (let i = 0; i < bytes.length; i++) {
      const byte = bytes[i]!;
      if (byte !== 10 && byte !== 13) {
        previousCR = false;
        newlines = 0;
        continue;
      }
      append(decoder.decode(bytes.subarray(from, i)));
      from = i + 1;
      if (byte === 10 && previousCR) {
        previousCR = false;
        if (newlines >= 2) start = offset + i + 1;
        continue;
      }
      previousCR = byte === 13;
      newlines++;
      if (newlines === 1) {
        firstNewline = offset + i;
        append("\n");
      } else {
        if (newlines === 2) finish(firstNewline);
        start = offset + i + 1;
      }
    }
    append(decoder.decode(bytes.subarray(from), { stream: true }));
  }
  append(decoder.decode());
  finish(file.size);
  signal?.throwIfAborted();
  return ranges.length ? ranges : [{ start: 0, end: file.size, length: 4 }];
}

export async function readTxtRange(file: Blob, range: TxtRange): Promise<string> {
  return (
    (await file.slice(range.start, range.end).text()).replace(/\r\n?/gu, "\n").trim() || "暂无内容"
  );
}

export async function searchTxt(
  file: Blob,
  ranges: readonly TxtRange[],
  bookId: string,
  query: string,
  signal?: AbortSignal,
): Promise<TxtSearchHit[]> {
  const hits: TxtSearchHit[] = [];
  // Read batches instead of making one storage request per short paragraph.
  for (let index = 0; index < ranges.length && hits.length < 80;) {
    signal?.throwIfAborted();
    const first = ranges[index]!;
    let endIndex = index + 1;
    while (endIndex < ranges.length && ranges[endIndex]!.end - first.start <= TXT_CHUNK_BYTES)
      endIndex++;
    const end = ranges[endIndex - 1]!.end;
    const batch = await file.slice(first.start, end).arrayBuffer();
    for (; index < endIndex && hits.length < 80; index++) {
      const range = ranges[index]!;
      const text =
        new TextDecoder()
          .decode(new Uint8Array(batch, range.start - first.start, range.end - range.start))
          .replace(/\r\n?/gu, "\n")
          .trim() || "暂无内容";
      for (const match of searchTextRanges(text, query, 80 - hits.length)) {
        const excerptStart = Math.max(0, match.start - 80);
        hits.push({
          excerpt: text.slice(excerptStart, match.start + match.length + 80),
          excerptStart,
          version: textVersion(text),
          bookId,
          sectionId: `section-${index + 1}`,
          label: `段落 ${index + 1}`,
          snippet: makeSnippet(text, match.start, match.length),
          score: 1,
          matchStart: match.start,
          matchLength: match.length,
        });
      }
    }
  }
  signal?.throwIfAborted();
  return hits;
}

export function validTxtRanges(
  sections: readonly { id: string; textRange?: TxtRange | undefined }[],
  size: number,
): boolean {
  let end = 0;
  return (
    sections.length > 0 &&
    sections.every((section, index) => {
      const range = section.textRange;
      if (
        !range ||
        section.id !== `section-${index + 1}` ||
        !Number.isSafeInteger(range.start) ||
        !Number.isSafeInteger(range.end) ||
        !Number.isSafeInteger(range.length) ||
        range.start < end ||
        range.end < range.start ||
        range.end > size ||
        range.length < 1
      )
        return false;
      end = range.end;
      return true;
    })
  );
}
