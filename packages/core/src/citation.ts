import { contentHash } from "./content-hash";

export interface TextRange {
  readonly start: number;
  readonly end: number;
}
export interface CitationSource {
  /** Stable identity of the source being searched (chapter, block or transcript). */
  readonly scope: string;
  readonly version: string;
  /** Identity of an addressable unit within that source. */
  readonly unit: string;
  /** UTF-16 position of this projection in the unit's complete text. */
  readonly offset: number;
}
export interface TextCitation {
  readonly version: 1;
  readonly source: CitationSource;
  readonly start: number;
  readonly exact: string;
  readonly prefix: string;
  readonly suffix: string;
  /** Relative UTF-16 range of the actual search hit in exact. */
  readonly hit: TextRange;
}
export interface CitationCandidate {
  readonly text: string;
  readonly source: CitationSource;
}
export type CitationResolution =
  | {
      readonly status: "exact" | "relocated";
      readonly candidate: number;
      readonly range: TextRange;
      readonly hit: TextRange;
    }
  | { readonly status: "missing" | "changed" | "ambiguous" };

export function textVersion(text: string): string {
  return contentHash(new TextEncoder().encode(text));
}

/** Grapheme normalization preserves combining sequences and original UTF-16 ranges. */
export function mappedSearchText(text: string) {
  let value = "";
  const starts: number[] = [],
    ends: number[] = [];
  const segments = new Intl.Segmenter("und", { granularity: "grapheme" }).segment(text);
  for (const { segment, index } of segments) {
    for (const point of segment.normalize("NFKC").toLowerCase()) {
      if (/\s/u.test(point)) {
        if (value.endsWith(" ")) {
          ends[ends.length - 1] = index + segment.length;
          continue;
        }
        value += " ";
        starts.push(index);
        ends.push(index + segment.length);
      } else {
        value += point;
        for (let i = 0; i < point.length; i++) {
          starts.push(index);
          ends.push(index + segment.length);
        }
      }
    }
  }
  return { value, starts, ends };
}
export function findTextMatches(text: string, query: string, limit = 200): TextRange[] {
  const needle = query.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
  if (!needle) return [];
  const mapped = mappedSearchText(text);
  const ranges: TextRange[] = [];
  let cursor = 0;
  while (ranges.length < limit) {
    const start = mapped.value.indexOf(needle, cursor);
    if (start < 0) break;
    ranges.push({ start: mapped.starts[start]!, end: mapped.ends[start + needle.length - 1]! });
    cursor = start + needle.length;
  }
  return ranges;
}
function boundary(text: string, offset: number, end = false): number {
  if (offset > 0 && offset < text.length && /[\uDC00-\uDFFF]/u.test(text[offset]!))
    return offset + (end ? 1 : -1);
  return offset;
}

/** A bounded sentence/context snapshot, never a guessed normalized-string offset. */
export function createTextCitation(
  text: string,
  source: CitationSource,
  hit: TextRange,
): TextCitation {
  if (hit.start < 0 || hit.end <= hit.start || hit.end > text.length || hit.end - hit.start > 512)
    throw new Error("引用命中范围无效或过长");
  let start = boundary(text, Math.max(0, hit.start - 120));
  let end = boundary(text, Math.min(text.length, Math.max(hit.end, hit.start + 360)), true);
  const before = text.slice(start, hit.start);
  const separators = [...before.matchAll(/[。！？.!?\n]/gu)];
  const previous = separators.at(-1);
  if (previous) start += previous.index! + previous[0].length;
  const after = text.slice(hit.end, end).search(/[。！？.!?\n]/u);
  if (after >= 0) end = hit.end + after + 1;
  while (start < hit.start && /\s/u.test(text[start]!)) start++;
  while (end > hit.end && /\s/u.test(text[end - 1]!)) end--;
  return {
    version: 1,
    source,
    start: source.offset + start,
    exact: text.slice(start, end),
    prefix: text.slice(boundary(text, Math.max(0, start - 80)), start),
    suffix: text.slice(end, boundary(text, Math.min(text.length, end + 80), true)),
    hit: { start: hit.start - start, end: hit.end - start },
  };
}
export function decodeCitationSource(value: unknown): CitationSource | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as CitationSource;
  return [source.scope, source.version, source.unit].every(
    (item) => typeof item === "string" && item.length > 0 && item.length <= 2048,
  ) &&
    Number.isSafeInteger(source.offset) &&
    source.offset >= 0
    ? source
    : undefined;
}
export function decodeTextCitation(value: unknown): TextCitation | undefined {
  if (!value || typeof value !== "object") return undefined;
  const citation = value as TextCitation;
  if (
    citation.version !== 1 ||
    !decodeCitationSource(citation.source) ||
    !Number.isSafeInteger(citation.start) ||
    citation.start < 0 ||
    typeof citation.exact !== "string" ||
    !citation.exact ||
    citation.exact.length > 1024 ||
    typeof citation.prefix !== "string" ||
    citation.prefix.length > 160 ||
    typeof citation.suffix !== "string" ||
    citation.suffix.length > 160 ||
    !citation.hit ||
    !Number.isSafeInteger(citation.hit.start) ||
    !Number.isSafeInteger(citation.hit.end) ||
    citation.hit.start < 0 ||
    citation.hit.end <= citation.hit.start ||
    citation.hit.end > citation.exact.length
  )
    return undefined;
  return citation;
}
export function citationFromParams(params: URLSearchParams): TextCitation | undefined {
  const raw = params.get("cite");
  if (!raw || raw.length > 12000) return undefined;
  try {
    return decodeTextCitation(JSON.parse(raw));
  } catch {
    return undefined;
  }
}
export function withTextCitation(route: string, citation: TextCitation): string {
  const url = new URL(route, "https://bcr.invalid");
  url.searchParams.set("cite", JSON.stringify(citation));
  return `${url.pathname}${url.search}`;
}

/** Never use proximity to choose between repeated passages in a changed source. */
export function resolveTextCitation(
  citation: TextCitation,
  candidates: ReadonlyArray<CitationCandidate>,
): CitationResolution {
  // Reassemble overlapping chapter projections so edits that shift a quote across
  // a chunk boundary do not turn a still-existing passage into a missing one.
  const groups = new Map<string, Array<CitationCandidate & { index: number }>>();
  candidates.forEach((candidate, index) => {
    if (candidate.source.scope !== citation.source.scope) return;
    const key = JSON.stringify([candidate.source.unit, candidate.source.version]);
    const list = groups.get(key) ?? [];
    list.push({ ...candidate, index });
    groups.set(key, list);
  });
  const scoped: Array<CitationCandidate & { index: number }> = [];
  for (const group of groups.values()) {
    let current: (CitationCandidate & { index: number }) | undefined;
    for (const next of group.sort((a, b) => a.source.offset - b.source.offset)) {
      const delta = current ? next.source.offset - current.source.offset : 0;
      if (
        current &&
        delta <= current.text.length &&
        current.text.slice(delta, delta + next.text.length) ===
          next.text.slice(0, Math.min(next.text.length, current.text.length - delta))
      ) {
        const overlap = current.text.length - delta;
        current = { ...current, text: current.text + next.text.slice(overlap) };
      } else {
        if (current) scoped.push(current);
        current = next;
      }
    }
    if (current) scoped.push(current);
  }
  if (!scoped.length) return { status: "missing" };
  for (const candidate of scoped) {
    const start = citation.start - candidate.source.offset;
    if (
      candidate.source.version === citation.source.version &&
      candidate.source.unit === citation.source.unit &&
      start >= 0 &&
      candidate.text.slice(start, start + citation.exact.length) === citation.exact
    ) {
      return {
        status: "exact",
        candidate: candidate.index,
        range: {
          start: start + candidate.source.offset,
          end: start + candidate.source.offset + citation.exact.length,
        },
        hit: {
          start: start + candidate.source.offset + citation.hit.start,
          end: start + candidate.source.offset + citation.hit.end,
        },
      };
    }
  }
  const matches = new Map<
    string,
    { candidate: number; range: TextRange; hit: TextRange; contextual: boolean }
  >();
  const norm = (text: string) => mappedSearchText(text).value.trim();
  for (const candidate of scoped) {
    // More than 200 occurrences must remain ambiguous, never appear unique.
    const ranges = findTextMatches(candidate.text, citation.exact, 201);
    if (ranges.length > 200) return { status: "ambiguous" };
    for (const range of ranges) {
      const text = candidate.text.slice(range.start, range.end);
      const originalMap = mappedSearchText(citation.exact);
      const localMap = mappedSearchText(text);
      const normalizedStart = originalMap.starts.findIndex(
        (offset) => offset >= citation.hit.start,
      );
      let normalizedEnd = originalMap.ends.findLastIndex((offset) => offset <= citation.hit.end);
      if (normalizedEnd < normalizedStart) normalizedEnd = normalizedStart;
      const hit = {
        start: range.start + (localMap.starts[normalizedStart] ?? 0),
        end: range.start + (localMap.ends[normalizedEnd] ?? text.length),
      };
      const before = candidate.text.slice(
        Math.max(0, range.start - citation.prefix.length * 3),
        range.start,
      );
      const after = candidate.text.slice(range.end, range.end + citation.suffix.length * 3);
      const contextual =
        (!citation.prefix || norm(before).endsWith(norm(citation.prefix))) &&
        (!citation.suffix || norm(after).startsWith(norm(citation.suffix)));
      const key = `${candidate.source.unit}:${candidate.source.offset + range.start}:${candidate.source.offset + range.end}`;
      const previous = matches.get(key);
      if (!previous || contextual)
        matches.set(key, {
          candidate: candidate.index,
          range: {
            start: range.start + candidate.source.offset,
            end: range.end + candidate.source.offset,
          },
          hit: {
            start: hit.start + candidate.source.offset,
            end: hit.end + candidate.source.offset,
          },
          contextual,
        });
    }
  }
  const all = [...matches.values()];
  const contextual = all.filter((item) => item.contextual);
  const selected = contextual.length ? contextual : all;
  if (!selected.length) return { status: "changed" };
  if (selected.length !== 1) return { status: "ambiguous" };
  const match = selected[0]!;
  return { status: "relocated", candidate: match.candidate, range: match.range, hit: match.hit };
}
