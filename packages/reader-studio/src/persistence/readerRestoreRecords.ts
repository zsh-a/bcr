import { contentHash } from "@bcr/core";
import {
  normalizeLocator,
  progressForLocator,
  resolveTextAnchor,
  type ReaderAnnotation,
  type ReaderBook,
  type ReaderBookmark,
  type ReaderLocator,
} from "@bcr/reader-core";
import type { ReaderState } from "../state/model";
import { classifyBackupBooks, type ReaderBackup } from "./readerBackup";

export type ReaderRestoreRecords = Pick<
  ReaderState,
  "progressByBook" | "bookmarksByBook" | "annotationsByBook"
>;

export interface ReaderRestoreRecordSummary {
  readonly id: string;
  readonly title: string;
  readonly targetId: string;
  readonly fresh: boolean;
  progressAdded: number;
  progressKept: number;
  bookmarksAdded: number;
  annotationsAdded: number;
  conflicts: number;
  skipped: number;
}

/** Never silently turn an unresolvable backup position into the start of a book. */
function remapLocator(
  source: ReaderBook,
  target: ReaderBook,
  locator: ReaderLocator,
  sameSource: boolean,
): ReaderLocator | undefined {
  const original = source.sections.find((section) => section.id === locator.sectionId);
  let section = target.sections.find((section) => section.id === locator.sectionId);
  if (!section && locator.href !== undefined)
    section = target.sections.find((section) => section.href === locator.href);
  if (!section && locator.pageNumber !== undefined)
    section = target.sections.find((section) => section.pageNumber === locator.pageNumber);
  if (
    !section &&
    original &&
    sameSource &&
    source.sections.length === target.sections.length &&
    source.sections.every((item, index) => {
      const candidate = target.sections[index];
      return (
        candidate !== undefined &&
        item.kind === candidate.kind &&
        (!item.text || !candidate.text || item.text === candidate.text) &&
        (!item.href || !candidate.href || item.href === candidate.href) &&
        (!item.textRange ||
          !candidate.textRange ||
          (item.textRange.start === candidate.textRange.start &&
            item.textRange.end === candidate.textRange.end))
      );
    })
  )
    section = target.sections[source.sections.indexOf(original)];
  if (!section && original?.text) {
    const matches = target.sections.filter((item) => item.text === original.text);
    if (matches.length === 1) section = matches[0];
  }
  if (!section && locator.textAnchor) {
    const matches = target.sections.filter(
      (item) => resolveTextAnchor(item.text, locator.textAnchor) !== undefined,
    );
    if (matches.length === 1) section = matches[0];
  }
  if (!section || (original && section.kind !== original.kind)) return undefined;
  return normalizeLocator(target, { ...locator, sectionId: section.id });
}

function recordSignature(item: ReaderBookmark | ReaderAnnotation): string {
  const locator = item.locator;
  return JSON.stringify([
    item.label,
    "note" in item ? item.note : null,
    item.createdAt,
    locator.kind,
    locator.sectionId,
    locator.progression,
    locator.pageNumber,
    locator.href,
    locator.textAnchor?.exact,
    locator.textAnchor?.prefix,
    locator.textAnchor?.suffix,
    locator.textAnchor?.start,
    locator.textAnchor?.end,
    locator.imageAnchor?.index,
    locator.imageAnchor?.x,
    locator.imageAnchor?.y,
  ]);
}

function mergeRecords<T extends ReaderBookmark | ReaderAnnotation>(
  current: ReadonlyArray<T>,
  incoming: ReadonlyArray<T>,
): { records: ReadonlyArray<T>; added: number; conflicts: number } {
  const records = [...current];
  const ids = new Set(records.map((item) => item.id));
  const signatures = new Set(records.map(recordSignature));
  let conflicts = 0;
  for (const item of incoming) {
    const signature = recordSignature(item);
    if (signatures.has(signature)) continue;
    const conflict = ids.has(item.id);
    // Preserve both versions of an edited record. A content-derived identity makes
    // the same ZIP safe to restore repeatedly without creating another copy.
    const id = conflict
      ? `${item.id}-restored-${contentHash(new TextEncoder().encode(signature))}`
      : item.id;
    if (ids.has(id)) continue;
    records.push({ ...item, id });
    ids.add(id);
    signatures.add(signature);
    conflicts += Number(conflict);
  }
  const added = records.length - current.length;
  if (added) records.sort((left, right) => right.createdAt - left.createdAt);
  return { records: added ? records : current, added, conflicts };
}

/** Plan from the latest live state; preview and publication use the same rules. */
export function planReaderRestoreRecords(
  backup: ReaderBackup,
  state: Pick<ReaderState, "library"> & ReaderRestoreRecords,
  preparedBooks: ReadonlyArray<ReaderBook> = [],
) {
  const classification = classifyBackupBooks(backup, state.library);
  const fresh = new Set(classification.fresh.map((entry) => entry.book.id));
  const available = new Map([...state.library, ...preparedBooks].map((book) => [book.id, book]));
  const entries: ReaderRestoreRecordSummary[] = [];
  const progressByBook = { ...state.progressByBook };
  const bookmarksByBook = { ...state.bookmarksByBook };
  const annotationsByBook = { ...state.annotationsByBook };
  const locators = new Map<string, (locator: ReaderLocator) => ReaderLocator | undefined>();
  for (const entry of backup.books) {
    const source = entry.book;
    const identity = classification.targets.get(source.id)!;
    const target = available.get(identity.id) ?? identity;
    const sourceHash = entry.source?.hash;
    const targetHash =
      target.source.ref?.hash ??
      backup.books.find((item) => item.book.id === target.id)?.source?.hash;
    const incompatibleSource =
      sourceHash !== undefined && targetHash !== undefined && sourceHash !== targetHash;
    const sameSource = sourceHash !== undefined && sourceHash === targetHash;
    const mapLocator = (locator: ReaderLocator) =>
      incompatibleSource ? undefined : remapLocator(source, target, locator, sameSource);
    locators.set(source.id, mapLocator);
    const summary: ReaderRestoreRecordSummary = {
      id: source.id,
      title: source.title,
      targetId: target.id,
      fresh: fresh.has(source.id),
      progressAdded: 0,
      progressKept: 0,
      bookmarksAdded: 0,
      annotationsAdded: 0,
      conflicts: 0,
      skipped: 0,
    };
    const progress = backup.progressByBook[source.id];
    if (progress) {
      if (progressByBook[target.id]) summary.progressKept++;
      else {
        const locator = mapLocator(progress.locator);
        if (locator) {
          progressByBook[target.id] = progressForLocator(target, locator, progress.updatedAt);
          summary.progressAdded++;
        } else summary.skipped++;
      }
    }
    const mappedRecords = <T extends ReaderBookmark | ReaderAnnotation>(
      records: ReadonlyArray<T>,
    ): T[] =>
      records.flatMap((item) => {
        const locator = mapLocator(item.locator);
        if (locator) return [{ ...item, locator }];
        summary.skipped++;
        return [];
      });
    const bookmarks = mergeRecords(
      bookmarksByBook[target.id] ?? [],
      mappedRecords(backup.bookmarksByBook[source.id] ?? []),
    );
    const annotations = mergeRecords(
      annotationsByBook[target.id] ?? [],
      mappedRecords(backup.annotationsByBook[source.id] ?? []),
    );
    bookmarksByBook[target.id] = bookmarks.records;
    annotationsByBook[target.id] = annotations.records;
    summary.bookmarksAdded = bookmarks.added;
    summary.annotationsAdded = annotations.added;
    summary.conflicts = bookmarks.conflicts + annotations.conflicts;
    entries.push(summary);
  }
  const remapHistory = (items: ReaderState["navigationHistory"]["back"]) =>
    items.flatMap((item) => {
      const locator = locators.get(item.bookId)?.(item.locator);
      const target = classification.targets.get(item.bookId);
      return locator && target ? [{ bookId: target.id, locator }] : [];
    });
  const search = backup.searchSession;
  const searchSession = search
    ? {
        ...search,
        searchBookId:
          search.searchBookId === null
            ? null
            : (classification.targets.get(search.searchBookId)?.id ?? null),
      }
    : undefined;
  const settings = {
    ...backup.settings,
    books: Object.fromEntries(
      Object.entries(backup.settings.books ?? {}).flatMap(([id, value]) => {
        const target = classification.targets.get(id);
        return target ? [[target.id, value]] : [];
      }),
    ),
  };
  const added = entries.reduce(
    (sum, item) => sum + item.progressAdded + item.bookmarksAdded + item.annotationsAdded,
    0,
  );
  return {
    records: { progressByBook, bookmarksByBook, annotationsByBook },
    entries,
    added,
    settings,
    navigationHistory: {
      back: remapHistory(backup.navigationHistory?.back ?? []),
      forward: remapHistory(backup.navigationHistory?.forward ?? []),
    },
    searchSession,
  };
}
