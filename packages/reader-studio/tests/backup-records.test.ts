import { beforeEach, describe, expect, it } from "vitest";
import { createLocator, progressForLocator, type ReaderBook } from "@bcr/reader-core";
import { classifyBackupBooks, type ReaderBackup } from "../src/persistence/readerBackup";
import { planReaderRestoreRecords } from "../src/persistence/readerRestoreRecords";
import { createDemoBook, DEFAULT_READER_SETTINGS } from "../src/state/model";
import { getReaderState, reader } from "../src/state/store";

const hash = "a".repeat(64);
function publication(id: string): ReaderBook {
  const base = createDemoBook();
  return {
    ...base,
    id,
    title: id,
    source: {
      ...base.source,
      ref: { id: `reader/${hash}`, hash, size: 100, mime: "text/plain", storage: "memory" },
    },
    sections: base.sections.map((section, index) => ({ ...section, id: `${id}-section-${index}` })),
  };
}
const local = publication("local");
const remote = publication("remote");
function manifest(books = [remote]): ReaderBackup {
  return {
    format: "bcr-reader-backup",
    version: 1,
    createdAt: 1,
    books: books.map((book) => ({
      book,
      source: { path: `sources/${hash}`, hash, size: 100 },
    })),
    settings: DEFAULT_READER_SETTINGS,
    progressByBook: {},
    bookmarksByBook: {},
    annotationsByBook: {},
  };
}
const remoteLocator = createLocator(remote.sections[2]!, 0.6);
const bookmark = { id: "bookmark", label: "备份书签", locator: remoteLocator, createdAt: 10 };
const annotation = { ...bookmark, id: "note", note: "备份笔记", updatedAt: 11 };
beforeEach(() => reader.hydrate([local], {}, DEFAULT_READER_SETTINGS, {}, local.id));

describe("Reader same-source record restore", () => {
  it("remaps distinct publication identities and retains the live read and metadata", () => {
    reader.renameBook(local.id, "本机书名");
    reader.toggleFavorite(local.id);
    reader.setLocator(createLocator(local.sections[1]!, 0.3));
    const before = getReaderState();
    const backup = {
      ...manifest(),
      progressByBook: { [remote.id]: progressForLocator(remote, remoteLocator, 12) },
      bookmarksByBook: { [remote.id]: [bookmark] },
      annotationsByBook: { [remote.id]: [annotation] },
    };
    const plan = planReaderRestoreRecords(backup, before);
    expect(plan.entries[0]).toMatchObject({
      fresh: false,
      progressKept: 1,
      bookmarksAdded: 1,
      annotationsAdded: 1,
      skipped: 0,
    });
    expect(plan.records.bookmarksByBook[local.id]?.[0]?.locator).toEqual(
      createLocator(local.sections[2]!, 0.6),
    );
    expect(plan.records.annotationsByBook[remote.id]).toBeUndefined();
    reader.mergeBackupRecords([], plan.records);
    expect(getReaderState().library[0]).toMatchObject({ title: "本机书名", favorite: true });
    expect(getReaderState().progressByBook[local.id]).toEqual(before.progressByBook[local.id]);
    expect(getReaderState().navigationSequence).toBe(before.navigationSequence);
    const repeated = planReaderRestoreRecords(backup, getReaderState());
    expect(repeated.added).toBe(0);
    expect(repeated.records.annotationsByBook[local.id]).toHaveLength(1);
  });

  it("fills a missing progress with a recomputed full-book percentage", () => {
    const backup = {
      ...manifest(),
      progressByBook: { [remote.id]: { locator: remoteLocator, percentage: 0.99, updatedAt: 10 } },
    };
    const plan = planReaderRestoreRecords(backup, getReaderState());
    expect(plan.records.progressByBook[local.id]).toEqual(
      progressForLocator(local, createLocator(local.sections[2]!, 0.6), 10),
    );
    expect(plan.entries[0]?.progressAdded).toBe(1);
    reader.mergeBackupRecords([], plan.records);
    expect(getReaderState().activeSectionId).toBe(local.sections[2]!.id);
  });

  it("preserves edited versions of the same record and remains idempotent", () => {
    const locator = createLocator(local.sections[2]!, 0.6);
    const current = {
      ...annotation,
      label: "本机标签",
      note: "本机编辑后的笔记",
      locator,
      updatedAt: 50,
    };
    reader.hydrate(
      [local],
      {},
      DEFAULT_READER_SETTINGS,
      { [local.id]: [{ ...bookmark, label: "本机书签", locator }] },
      local.id,
      { [local.id]: [current] },
    );
    const backup = {
      ...manifest(),
      bookmarksByBook: { [remote.id]: [bookmark] },
      annotationsByBook: { [remote.id]: [annotation] },
    };
    const plan = planReaderRestoreRecords(backup, getReaderState());
    expect(plan.entries[0]?.conflicts).toBe(2);
    expect(plan.records.annotationsByBook[local.id]?.map((item) => item.note)).toEqual([
      current.note,
      annotation.note,
    ]);
    expect(plan.records.annotationsByBook[local.id]?.[1]?.id).toMatch(/^note-restored-/u);
    reader.mergeBackupRecords([], plan.records);
    const repeated = planReaderRestoreRecords(backup, getReaderState());
    expect(repeated.added).toBe(0);
    expect(repeated.records.bookmarksByBook[local.id]).toHaveLength(2);
    expect(repeated.records.annotationsByBook[local.id]?.[0]).toEqual(current);
  });

  it("reports unresolvable structure changes and source conflicts without a start fallback", () => {
    const changed = { ...local, sections: [local.sections[0]!] };
    const backup = {
      ...manifest(),
      bookmarksByBook: { [remote.id]: [bookmark] },
      annotationsByBook: { [remote.id]: [annotation] },
    };
    reader.hydrate([changed], {}, DEFAULT_READER_SETTINGS);
    const plan = planReaderRestoreRecords(backup, getReaderState());
    expect(plan.entries[0]?.skipped).toBe(2);
    expect(plan.added).toBe(0);
    const collision = {
      ...remote,
      source: { ...remote.source, ref: { ...remote.source.ref!, hash: "b".repeat(64) } },
    };
    reader.hydrate([collision], {}, DEFAULT_READER_SETTINGS);
    expect(planReaderRestoreRecords(backup, getReaderState()).entries[0]?.skipped).toBe(2);
  });

  it("deduplicates backup publications while merging all their distinct reading records", () => {
    const copy = publication("another-backup-copy");
    const other = {
      ...annotation,
      id: "other-note",
      note: "另一份备份笔记",
      locator: createLocator(copy.sections[3]!, 0.2),
    };
    const backup = {
      ...manifest([remote, copy]),
      annotationsByBook: { [remote.id]: [annotation], [copy.id]: [other] },
    };
    reader.hydrate([], {}, DEFAULT_READER_SETTINGS);
    const state = { ...getReaderState(), library: [] };
    expect(classifyBackupBooks(backup, []).fresh).toHaveLength(1);
    const plan = planReaderRestoreRecords(backup, state, [remote]);
    expect(plan.records.annotationsByBook[remote.id]).toHaveLength(2);
    expect(plan.records.annotationsByBook[remote.id]?.[1]?.locator.sectionId).toBe(
      remote.sections[3]!.id,
    );
    expect(plan.records.annotationsByBook[copy.id]).toBeUndefined();
  });

  it("retains distinct collection snapshots sharing one source", () => {
    const snapshot = { ...remote, preserveSectionSnapshot: true };
    const otherSnapshot = { ...publication("collection-two"), preserveSectionSnapshot: true };
    const backup = manifest([snapshot, otherSnapshot]);
    expect(classifyBackupBooks(backup, [local]).fresh.map((item) => item.book.id)).toEqual([
      snapshot.id,
      otherSnapshot.id,
    ]);
    expect(
      classifyBackupBooks(backup, [{ ...local, preserveSectionSnapshot: true }]).fresh,
    ).toHaveLength(2);
  });

  it("remaps optional history, search and book preferences to local identities", () => {
    const backup = {
      ...manifest(),
      settings: { ...DEFAULT_READER_SETTINGS, books: { [remote.id]: { pdfZoom: 1.5 } } },
      navigationHistory: { back: [{ bookId: remote.id, locator: remoteLocator }], forward: [] },
      searchSession: {
        scope: "book" as const,
        query: "关键词",
        searchBookId: remote.id,
        searchOpen: true,
      },
    };
    const plan = planReaderRestoreRecords(backup, getReaderState());
    expect(plan.navigationHistory.back).toEqual([
      { bookId: local.id, locator: createLocator(local.sections[2]!, 0.6) },
    ]);
    expect(plan.searchSession?.searchBookId).toBe(local.id);
    expect(plan.settings.books).toEqual({ [local.id]: { pdfZoom: 1.5 } });
  });

  it("maps a PDF page across different section counts without losing the image anchor", () => {
    const page = (id: string, count: number) => ({
      ...publication(id),
      source: { ...local.source, format: "pdf" as const },
      sections: Array.from({ length: count }, (_, index) => ({
        id: `${id}-page-${index}`,
        order: index,
        label: `Page ${index + 1}`,
        kind: "pdf-page" as const,
        pageNumber: index + 1,
        text: "",
      })),
    });
    const original = page("remote", 2),
      target = page("local", 3);
    const locator = {
      ...createLocator(original.sections[1]!, 0.4),
      imageAnchor: { index: 0, x: 0.5, y: 0.2 },
    };
    const backup = {
      ...manifest([original]),
      bookmarksByBook: { [original.id]: [{ ...bookmark, locator }] },
    };
    reader.hydrate([target], {}, DEFAULT_READER_SETTINGS);
    const restored = planReaderRestoreRecords(backup, getReaderState()).records.bookmarksByBook[
      target.id
    ]?.[0]?.locator;
    expect(restored).toMatchObject({
      sectionId: target.sections[1]!.id,
      pageNumber: 2,
      progression: 0.4,
      imageAnchor: locator.imageAnchor,
    });
  });
});
