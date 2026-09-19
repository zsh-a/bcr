import {
  normalizeLocator,
  progressForLocator,
  type ReaderTextAnchor,
  type ReaderBook,
  type ReaderProgress,
} from "@bcr/reader-core";

export type ReaderProgressSnapshot = Readonly<Record<string, ReaderProgress>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function finiteTimestamp(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : Date.now();
}

function textAnchorValue(value: unknown): ReaderTextAnchor | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const source = value as Record<string, unknown>;
  if (typeof source["exact"] !== "string" || source["exact"].length === 0) return undefined;
  return {
    exact: source["exact"].slice(0, 512),
    ...(typeof source["prefix"] === "string" ? { prefix: source["prefix"].slice(-96) } : {}),
    ...(typeof source["suffix"] === "string" ? { suffix: source["suffix"].slice(0, 96) } : {}),
    ...(typeof source["start"] === "number" &&
    Number.isInteger(source["start"]) &&
    source["start"] >= 0
      ? { start: source["start"] }
      : {}),
    ...(typeof source["end"] === "number" && Number.isInteger(source["end"]) && source["end"] >= 0
      ? { end: source["end"] }
      : {}),
  };
}

/**
 * Validate and migrate persisted progress against the freshly parsed book.
 *
 * A Locator is the durable contract; percentage is derived again so a stale
 * layout or an old section order cannot restore a misleading pixel position.
 * Unknown books are intentionally dropped instead of leaking deleted content
 * back into the active session.
 */
export function normalizeReaderProgress(
  books: ReadonlyArray<ReaderBook>,
  raw: unknown,
): ReaderProgressSnapshot {
  if (!isRecord(raw)) return {};
  const restored: Record<string, ReaderProgress> = {};
  for (const book of books) {
    const candidate = raw[book.id];
    if (!isRecord(candidate) || !isRecord(candidate.locator)) continue;
    const locatorValue = candidate.locator;
    if (typeof locatorValue.sectionId !== "string") continue;
    const kind =
      locatorValue.kind === "page" || locatorValue.kind === "image" ? locatorValue.kind : "section";
    const textAnchor = textAnchorValue(locatorValue.textAnchor);
    const image = locatorValue.imageAnchor;
    const imageAnchor =
      isRecord(image) &&
      typeof image.index === "number" &&
      typeof image.x === "number" &&
      typeof image.y === "number"
        ? { index: image.index, x: image.x, y: image.y }
        : undefined;
    const sectionStillExists =
      book.sections.some((section) => section.id === locatorValue.sectionId) ||
      (typeof locatorValue.href === "string" &&
        book.sections.some((section) => section.href === locatorValue.href)) ||
      (typeof locatorValue.pageNumber === "number" &&
        book.sections.some((section) => section.pageNumber === locatorValue.pageNumber)) ||
      (textAnchor !== undefined &&
        book.sections.some((section) => section.text.includes(textAnchor.exact)));
    const locator = normalizeLocator(book, {
      kind,
      sectionId: locatorValue.sectionId,
      progression:
        sectionStillExists && typeof locatorValue.progression === "number"
          ? locatorValue.progression
          : 0,
      ...(typeof locatorValue.pageNumber === "number"
        ? { pageNumber: locatorValue.pageNumber }
        : {}),
      ...(typeof locatorValue.href === "string" ? { href: locatorValue.href } : {}),
      ...(textAnchor === undefined ? {} : { textAnchor }),
      ...(sectionStillExists && imageAnchor !== undefined ? { imageAnchor } : {}),
    });
    restored[book.id] = progressForLocator(book, locator, finiteTimestamp(candidate.updatedAt));
  }
  return restored;
}
