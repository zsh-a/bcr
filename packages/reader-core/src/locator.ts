import type {
  ReaderBook,
  ReaderAnnotation,
  ReaderBookmark,
  ReaderLocator,
  ReaderProgress,
  ReaderSection,
  ReaderTextAnchor,
} from "./model";

const MAX_ANCHOR_EXACT_LENGTH = 512;
const MAX_ANCHOR_CONTEXT_LENGTH = 96;

export function clampProgression(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function finiteOffset(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

/** Create a bounded, durable text anchor from an original section range. */
export function createTextAnchor(
  text: string,
  start: number,
  end: number,
  context = MAX_ANCHOR_CONTEXT_LENGTH,
): ReaderTextAnchor | undefined {
  if (text.length === 0) return undefined;
  const safeStart = Math.min(text.length, Math.max(0, Math.floor(start)));
  const safeEnd = Math.min(text.length, Math.max(safeStart, Math.floor(end)));
  if (safeEnd <= safeStart) return undefined;
  const exactEnd = Math.min(safeEnd, safeStart + MAX_ANCHOR_EXACT_LENGTH);
  const contextLength = Math.min(MAX_ANCHOR_CONTEXT_LENGTH, Math.max(0, Math.floor(context)));
  return {
    exact: text.slice(safeStart, exactEnd),
    ...(safeStart > 0
      ? { prefix: text.slice(Math.max(0, safeStart - contextLength), safeStart) }
      : {}),
    ...(exactEnd < text.length
      ? { suffix: text.slice(exactEnd, Math.min(text.length, exactEnd + contextLength)) }
      : {}),
    start: safeStart,
    end: exactEnd,
  };
}

/** Find a text anchor in a possibly reflowed section. */
export function resolveTextAnchor(
  text: string,
  anchor: ReaderTextAnchor | undefined,
): { start: number; length: number } | undefined {
  if (anchor === undefined || anchor.exact.length === 0 || text.length === 0) return undefined;
  const hintedStart = finiteOffset(anchor.start);
  if (
    hintedStart !== undefined &&
    text.slice(hintedStart, hintedStart + anchor.exact.length) === anchor.exact
  ) {
    return { start: hintedStart, length: anchor.exact.length };
  }
  const candidates: number[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const index = text.indexOf(anchor.exact, cursor);
    if (index < 0) break;
    candidates.push(index);
    cursor = index + Math.max(1, anchor.exact.length);
  }
  if (candidates.length === 0) return undefined;
  const prefix = anchor.prefix ?? "";
  const suffix = anchor.suffix ?? "";
  const contextual = candidates.filter((candidate) => {
    const before = text.slice(Math.max(0, candidate - prefix.length), candidate);
    const after = text.slice(
      candidate + anchor.exact.length,
      candidate + anchor.exact.length + suffix.length,
    );
    return (
      (prefix.length === 0 || before.endsWith(prefix)) &&
      (suffix.length === 0 || after.startsWith(suffix))
    );
  });
  const matches = contextual.length > 0 ? contextual : candidates;
  const selected =
    hintedStart === undefined
      ? matches[0]
      : matches.reduce((best, candidate) =>
          Math.abs(candidate - hintedStart) < Math.abs(best - hintedStart) ? candidate : best,
        );
  return selected === undefined ? undefined : { start: selected, length: anchor.exact.length };
}

/** Normalize an anchor before persisting it and refresh its position hint. */
export function normalizeTextAnchor(
  text: string,
  anchor: ReaderTextAnchor | undefined,
): ReaderTextAnchor | undefined {
  if (anchor === undefined || typeof anchor.exact !== "string") return undefined;
  const exact = anchor.exact.slice(0, MAX_ANCHOR_EXACT_LENGTH);
  if (exact.length === 0) return undefined;
  const prefix =
    typeof anchor.prefix === "string" ? anchor.prefix.slice(-MAX_ANCHOR_CONTEXT_LENGTH) : undefined;
  const suffix =
    typeof anchor.suffix === "string"
      ? anchor.suffix.slice(0, MAX_ANCHOR_CONTEXT_LENGTH)
      : undefined;
  const candidate: ReaderTextAnchor = {
    exact,
    ...(prefix === undefined || prefix.length === 0 ? {} : { prefix }),
    ...(suffix === undefined || suffix.length === 0 ? {} : { suffix }),
    ...(finiteOffset(anchor.start) === undefined ? {} : { start: finiteOffset(anchor.start) }),
    ...(finiteOffset(anchor.end) === undefined ? {} : { end: finiteOffset(anchor.end) }),
  };
  const resolved = resolveTextAnchor(text, candidate);
  return resolved === undefined
    ? candidate
    : { ...candidate, start: resolved.start, end: resolved.start + resolved.length };
}

export function createLocator(
  section: ReaderSection,
  progression = 0,
  kind: ReaderLocator["kind"] = section.kind === "image"
    ? "image"
    : section.kind === "pdf-page"
      ? "page"
      : "section",
  textAnchor?: ReaderTextAnchor,
): ReaderLocator {
  return {
    kind,
    sectionId: section.id,
    progression: clampProgression(progression),
    ...(section.pageNumber === undefined ? {} : { pageNumber: section.pageNumber }),
    ...(section.href === undefined ? {} : { href: section.href }),
    ...(textAnchor === undefined ? {} : { textAnchor }),
  };
}

/** Build a locator that can be restored by quote even after text reflows. */
export function createTextLocator(
  section: ReaderSection,
  start: number,
  end: number,
  kind?: ReaderLocator["kind"],
): ReaderLocator {
  const anchor = createTextAnchor(section.text, start, end);
  const safeStart = Math.min(section.text.length, Math.max(0, Math.floor(start)));
  const progression = section.text.length === 0 ? 0 : safeStart / section.text.length;
  return createLocator(section, progression, kind ?? undefined, anchor);
}

export function firstLocator(book: ReaderBook): ReaderLocator {
  return createLocator(
    book.sections[0] ?? { id: "section-0", kind: "text", order: 0, label: "开始", text: "" },
  );
}

export function normalizeLocator(
  book: ReaderBook,
  locator: ReaderLocator | undefined,
): ReaderLocator {
  if (locator === undefined) return firstLocator(book);
  const anchor = locator.textAnchor;
  const directSection =
    book.sections.find((candidate) => candidate.id === locator.sectionId) ??
    (locator.href === undefined
      ? undefined
      : book.sections.find((candidate) => candidate.href === locator.href)) ??
    (locator.pageNumber === undefined
      ? undefined
      : book.sections.find((candidate) => candidate.pageNumber === locator.pageNumber));
  const section =
    directSection ??
    (anchor === undefined
      ? undefined
      : book.sections.find(
          (candidate) => resolveTextAnchor(candidate.text, anchor) !== undefined,
        )) ??
    book.sections[0];
  if (section === undefined) return firstLocator(book);
  const normalizedAnchor = normalizeTextAnchor(section.text, anchor);
  const resolvedAnchor = resolveTextAnchor(section.text, normalizedAnchor);
  const progression =
    resolvedAnchor === undefined || section.text.length === 0
      ? locator.progression
      : resolvedAnchor.start / section.text.length;
  const normalized = createLocator(section, progression, locator.kind, normalizedAnchor);
  const image = locator.imageAnchor;
  return directSection !== undefined &&
    image !== undefined &&
    image !== null &&
    Number.isInteger(image.index) &&
    image.index >= 0 &&
    Number.isFinite(image.x) &&
    Number.isFinite(image.y)
    ? {
        ...normalized,
        imageAnchor: {
          index: image.index,
          x: clampProgression(image.x),
          y: clampProgression(image.y),
        },
      }
    : normalized;
}

export function percentageForLocator(book: ReaderBook, locator: ReaderLocator): number {
  const index = readingWeights(book);
  const sectionIndex = index.sections.get(locator.sectionId) ?? 0;
  return clampProgression(
    ((index.offsets[sectionIndex] ?? 0) +
      (index.weights[sectionIndex] ?? 0) * clampProgression(locator.progression)) /
      Math.max(1, index.total),
  );
}

const weightCache = new WeakMap<
  ReaderBook,
  { weights: number[]; offsets: number[]; sections: Map<string, number>; total: number }
>();
function readingWeights(book: ReaderBook) {
  const cached = weightCache.get(book);
  if (cached) return cached;
  const weights = book.sections.map(sectionReadingWeight);
  let total = 0;
  const offsets = weights.map((weight) => {
    const offset = total;
    total += weight;
    return offset;
  });
  const index = {
    weights,
    offsets,
    sections: new Map(book.sections.map((section, index) => [section.id, index])),
    total,
  };
  weightCache.set(book, index);
  return index;
}

/** Image pages and text use content weights, never the number of chapter boundaries. */
export function sectionReadingWeight(section: ReaderSection): number {
  if (section.kind === "pdf-page" || section.kind === "image") return 1000;
  const images = section.html?.match(/<(?:img|svg)\b/giu)?.length ?? 0;
  return Math.max(1, images * 1000 + section.text.trim().length);
}

export function progressForLocator(
  book: ReaderBook,
  locator: ReaderLocator,
  updatedAt = Date.now(),
): ReaderProgress {
  const normalized = normalizeLocator(book, locator);
  return { locator: normalized, percentage: percentageForLocator(book, normalized), updatedAt };
}

export function sameLocator(left: ReaderLocator, right: ReaderLocator, tolerance = 0.02): boolean {
  return (
    left.sectionId === right.sectionId &&
    left.imageAnchor?.index === right.imageAnchor?.index &&
    (left.imageAnchor === undefined ||
      right.imageAnchor === undefined ||
      (Math.abs(left.imageAnchor.x - right.imageAnchor.x) <= tolerance &&
        Math.abs(left.imageAnchor.y - right.imageAnchor.y) <= tolerance)) &&
    Math.abs(clampProgression(left.progression) - clampProgression(right.progression)) <= tolerance
  );
}

export function normalizeBookmark(book: ReaderBook, bookmark: ReaderBookmark): ReaderBookmark {
  return { ...bookmark, locator: normalizeLocator(book, bookmark.locator) };
}

export function normalizeAnnotation(
  book: ReaderBook,
  annotation: ReaderAnnotation,
): ReaderAnnotation {
  return { ...annotation, locator: normalizeLocator(book, annotation.locator) };
}

export function locatorAtPercentage(book: ReaderBook, percentage: number): ReaderLocator {
  if (book.sections.length === 0) return firstLocator(book);
  const weights = book.sections.map(sectionReadingWeight);
  let remaining = clampProgression(percentage) * weights.reduce((sum, weight) => sum + weight, 0);
  for (const [index, section] of book.sections.entries()) {
    const weight = weights[index] ?? 1;
    if (remaining < weight || index === book.sections.length - 1)
      return createLocator(section, remaining / weight);
    remaining -= weight;
  }
  return firstLocator(book);
}
