import {
  normalizeAnnotation,
  normalizeBookmark,
  type ReaderAnnotation,
  type ReaderBook,
  type ReaderBookmark,
  type ReaderTextAnchor,
} from "@bcr/reader-core";
import { type ReaderSearchSession, type ReaderState } from "../state/model";
import { normalizeReaderProgress } from "../state/session-contract";
import { type PersistedBook } from "./model";

export function persistBook(book: ReaderBook): PersistedBook {
  return {
    ...(book.preserveSectionSnapshot ? { preserveSectionSnapshot: true } : {}),
    ...(book.rendition === undefined ? {} : { rendition: book.rendition }),
    id: book.id,
    title: book.title,
    ...(typeof book.favorite === "boolean" ? { favorite: book.favorite } : {}),
    ...(book.author === undefined ? {} : { author: book.author }),
    ...(book.language === undefined ? {} : { language: book.language }),
    source: {
      name: book.source.name,
      format: book.source.format,
      mime: book.source.mime,
      size: book.source.size,
      ...(book.source.ref === undefined ? {} : { ref: book.source.ref }),
    },
    sections: book.sections.map((section) => ({
      id: section.id,
      order: section.order,
      label: section.label,
      kind: section.kind,
      ...(section.contentInfo ? { contentInfo: section.contentInfo } : {}),
      ...(section.textRange ? { textRange: section.textRange } : {}),
      text: section.textRange || section.contentInfo ? "" : section.text,
      ...(section.textRange === undefined &&
      section.contentInfo === undefined &&
      section.html !== undefined
        ? { html: section.html }
        : {}),
      ...(section.pageNumber === undefined ? {} : { pageNumber: section.pageNumber }),
      ...(section.pageAspectRatio === undefined
        ? {}
        : { pageAspectRatio: section.pageAspectRatio }),
      ...(section.href === undefined ? {} : { href: section.href }),
      ...(section.imageAlt === undefined ? {} : { imageAlt: section.imageAlt }),
    })),
    ...(book.toc === undefined ? {} : { toc: book.toc }),
    importedAt: book.importedAt,
    updatedAt: book.updatedAt,
    tags: book.tags,
  };
}

export function readerLibrarySignature(
  books: ReadonlyArray<{
    readonly id: string;
    readonly updatedAt: number;
    readonly source: { readonly ref?: { readonly hash: string } | undefined };
    readonly sections: ReadonlyArray<unknown>;
  }>,
): string {
  return books
    .map(
      (book) =>
        `${book.id}:${book.updatedAt}:${book.source.ref?.hash ?? ""}:${book.sections.length}`,
    )
    .join("\u0000");
}

function textAnchorValue(value: unknown): ReaderTextAnchor | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const source = value as Record<string, unknown>;
  const exact = source["exact"];
  if (typeof exact !== "string" || exact.length === 0) return undefined;
  const prefix = source["prefix"];
  const suffix = source["suffix"];
  const start = source["start"];
  const end = source["end"];
  return {
    exact: exact.slice(0, 512),
    ...(typeof prefix === "string" ? { prefix: prefix.slice(-96) } : {}),
    ...(typeof suffix === "string" ? { suffix: suffix.slice(0, 96) } : {}),
    ...(typeof start === "number" && Number.isInteger(start) && start >= 0 ? { start } : {}),
    ...(typeof end === "number" && Number.isInteger(end) && end >= 0 ? { end } : {}),
  };
}

export function restoredBookmarks(
  books: ReadonlyArray<ReaderBook>,
  raw: unknown,
): ReaderState["bookmarksByBook"] {
  if (typeof raw !== "object" || raw === null) return {};
  const source = raw as Record<string, unknown>;
  const restored: Record<string, ReadonlyArray<ReaderBookmark>> = {};
  for (const book of books) {
    const candidates = source[book.id];
    if (!Array.isArray(candidates)) continue;
    const seen = new Set<string>();
    const bookmarks = candidates.flatMap((candidate) => {
      if (typeof candidate !== "object" || candidate === null) return [];
      const value = candidate as Record<string, unknown>;
      if (
        typeof value["id"] !== "string" ||
        typeof value["label"] !== "string" ||
        typeof value["createdAt"] !== "number" ||
        typeof value["locator"] !== "object" ||
        value["locator"] === null ||
        seen.has(value["id"])
      ) {
        return [];
      }
      const locatorValue = value["locator"] as Record<string, unknown>;
      if (typeof locatorValue["sectionId"] !== "string") return [];
      seen.add(value["id"]);
      const locator = normalizeReaderProgress([book], { [book.id]: { locator: locatorValue } })[
        book.id
      ]!.locator;
      return [
        normalizeBookmark(book, {
          id: value["id"],
          label: value["label"],
          createdAt: value["createdAt"],
          locator,
        }),
      ];
    });
    if (bookmarks.length > 0) restored[book.id] = bookmarks;
  }
  return restored;
}

export function restoredAnnotations(
  books: ReadonlyArray<ReaderBook>,
  raw: unknown,
): ReaderState["annotationsByBook"] {
  if (typeof raw !== "object" || raw === null) return {};
  const source = raw as Record<string, unknown>;
  const restored: Record<string, ReadonlyArray<ReaderAnnotation>> = {};
  for (const book of books) {
    const candidates = source[book.id];
    if (!Array.isArray(candidates)) continue;
    const seen = new Set<string>();
    const annotations = candidates.flatMap((candidate) => {
      if (typeof candidate !== "object" || candidate === null) return [];
      const value = candidate as Record<string, unknown>;
      if (
        typeof value["id"] !== "string" ||
        typeof value["label"] !== "string" ||
        typeof value["note"] !== "string" ||
        typeof value["createdAt"] !== "number" ||
        typeof value["updatedAt"] !== "number" ||
        typeof value["locator"] !== "object" ||
        value["locator"] === null ||
        seen.has(value["id"])
      ) {
        return [];
      }
      const locatorValue = value["locator"] as Record<string, unknown>;
      if (typeof locatorValue["sectionId"] !== "string") return [];
      seen.add(value["id"]);
      const locator = normalizeReaderProgress([book], { [book.id]: { locator: locatorValue } })[
        book.id
      ]!.locator;
      return [
        normalizeAnnotation(book, {
          id: value["id"],
          label: value["label"],
          note: value["note"].slice(0, 2_000),
          createdAt: value["createdAt"],
          updatedAt: Math.max(value["createdAt"], value["updatedAt"]),
          locator,
        }),
      ];
    });
    if (annotations.length > 0) restored[book.id] = annotations;
  }
  return restored;
}

export function restoredSearchSession(
  books: ReadonlyArray<ReaderBook>,
  raw: unknown,
): ReaderSearchSession {
  if (typeof raw !== "object" || raw === null) {
    return { query: "", searchBookId: null, searchOpen: false };
  }
  const source = raw as Record<string, unknown>;
  const query = typeof source["query"] === "string" ? source["query"].slice(0, 240) : "";
  const searchBookId =
    typeof source["searchBookId"] === "string" &&
    books.some((book) => book.id === source["searchBookId"])
      ? source["searchBookId"]
      : null;
  return {
    query,
    searchBookId,
    scope: source["scope"] === "book" ? "book" : "library",
    searchOpen: query.trim().length > 0 && source["searchOpen"] === true,
  };
}

export function restoreNavigationHistory(
  books: ReadonlyArray<ReaderBook>,
  raw: unknown,
): ReaderState["navigationHistory"] {
  const source = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const restore = (value: unknown): ReaderState["navigationHistory"]["back"] => {
    if (!Array.isArray(value)) return [];
    return value.slice(-50).flatMap((entry: unknown) => {
      if (typeof entry !== "object" || entry === null) return [];
      const candidate = entry as Record<string, unknown>;
      const book = books.find((item) => item.id === candidate["bookId"]);
      const locator = candidate["locator"];
      if (book === undefined || typeof locator !== "object" || locator === null) return [];
      const fields = locator as Record<string, unknown>;
      if (
        typeof fields["sectionId"] !== "string" ||
        !book.sections.some((section) => section.id === fields["sectionId"]) ||
        typeof fields["progression"] !== "number" ||
        !Number.isFinite(fields["progression"])
      )
        return [];
      const anchor = textAnchorValue(fields["textAnchor"]);
      return [
        {
          bookId: book.id,
          locator: normalizeReaderProgress([book], {
            [book.id]: { locator: { ...fields, textAnchor: anchor } },
          })[book.id]!.locator,
        },
      ];
    });
  };
  return { back: restore(source["back"]), forward: restore(source["forward"]) };
}
