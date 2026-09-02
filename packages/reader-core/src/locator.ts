import type {
  ReaderBook,
  ReaderAnnotation,
  ReaderBookmark,
  ReaderLocator,
  ReaderProgress,
  ReaderSection,
} from "./model";

export function clampProgression(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function createLocator(
  section: ReaderSection,
  progression = 0,
  kind: ReaderLocator["kind"] = section.kind === "image"
    ? "image"
    : section.kind === "pdf-page"
      ? "page"
      : "section",
): ReaderLocator {
  return {
    kind,
    sectionId: section.id,
    progression: clampProgression(progression),
    ...(section.pageNumber === undefined ? {} : { pageNumber: section.pageNumber }),
    ...(section.href === undefined ? {} : { href: section.href }),
  };
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
  const section =
    book.sections.find((candidate) => candidate.id === locator.sectionId) ??
    (locator.href === undefined
      ? undefined
      : book.sections.find((candidate) => candidate.href === locator.href)) ??
    (locator.pageNumber === undefined
      ? undefined
      : book.sections.find((candidate) => candidate.pageNumber === locator.pageNumber)) ??
    book.sections[0];
  if (section === undefined) return firstLocator(book);
  return createLocator(section, locator.progression, locator.kind);
}

export function percentageForLocator(book: ReaderBook, locator: ReaderLocator): number {
  const sectionIndex = Math.max(
    0,
    book.sections.findIndex((section) => section.id === locator.sectionId),
  );
  const denominator = Math.max(1, book.sections.length - 1);
  return clampProgression((sectionIndex + clampProgression(locator.progression)) / denominator);
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
  const position = clampProgression(percentage) * Math.max(1, book.sections.length - 1);
  const index = Math.min(book.sections.length - 1, Math.floor(position));
  const section = book.sections[index] ?? book.sections[0];
  if (section === undefined) return firstLocator(book);
  return createLocator(section, position - index);
}
