import { afterEach, describe, expect, it, vi } from "vitest";
import { createReaderRuntime } from "../src/readerRuntimeCore";
import { reader, getReaderState } from "../src/store";
import { createDemoBook, DEFAULT_READER_SETTINGS } from "../src/model";
import {
  restoreReaderTransfer,
  checkReaderTransfer,
  readerTransferState,
} from "../src/researchTransfer";
import { Effect } from "effect";
import { hashReadableStream } from "@bcr/core";
import type { PreparedReaderBackup } from "../src/readerBackup";
async function setup() {
  await createReaderRuntime();
  reader.hydrate([createDemoBook()], {}, DEFAULT_READER_SETTINGS);
  const source = new Blob(["恢复正文"]),
    hash = await hashReadableStream(source.stream());
  const book = {
    id: "conflict",
    title: "恢复资料",
    source: { name: "file.txt", format: "txt" as const, mime: "text/plain", size: source.size },
    sections: [{ id: "section", order: 0, label: "内容", kind: "text" as const, text: "恢复正文" }],
    tags: [],
    importedAt: 1,
    updatedAt: 1,
  };
  const prepared: PreparedReaderBackup = {
    manifest: {
      format: "bcr-reader-backup",
      version: 1,
      createdAt: 1,
      settings: DEFAULT_READER_SETTINGS,
      progressByBook: {},
      bookmarksByBook: {},
      annotationsByBook: {},
      books: [{ book, source: { hash, path: `sources/${hash}`, size: source.size } }],
    },
    sources: new Map([[`sources/${hash}`, source]]),
  };
  return { prepared, book };
}
afterEach(() => vi.unstubAllGlobals());
describe("Reader package source restoration", () => {
  it("preserves existing books, retries failed writes and avoids duplicates", async () => {
    const { prepared, book } = await setup();
    reader.hydrate([book], {}, DEFAULT_READER_SETTINGS);
    let fail = true;
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (fail) throw new Error("quota");
        values.set(key, value);
      },
      removeItem: (key: string) => values.delete(key),
    });
    await expect(restoreReaderTransfer(prepared, () => {})).rejects.toThrow();
    expect(getReaderState().library).toEqual([book]);
    fail = false;
    const bindings = await restoreReaderTransfer(prepared, () => {});
    expect(bindings[0]!.target).not.toBe(book.id);
    expect(getReaderState().library).toHaveLength(2);
    expect(getReaderState().library[0]).toEqual(book);
    await restoreReaderTransfer(prepared, () => {});
    expect(getReaderState().library).toHaveLength(2);
    const restored = getReaderState().library[1]!;
    const ref = restored.source.ref!;
    await Effect.runPromise(
      readerTransferState().runtime.artifacts.putStream(
        { ...ref, type: "file/publication", format: ref.mime },
        new Blob(["corrupt"]).stream(),
      ),
    );
    expect(await checkReaderTransfer([restored.id])).toEqual([restored.id]);
    await restoreReaderTransfer(prepared, () => {});
    expect(await checkReaderTransfer([restored.id])).toEqual([]);
    expect(getReaderState().library[1]).toBe(restored);
  });
  it("reuses deferred snapshots regardless of JSON property order and still rejects edits", async () => {
    const { prepared } = await setup();
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
    const entry = prepared.manifest.books[0]!;
    const deferred = {
      ...prepared,
      manifest: {
        ...prepared.manifest,
        books: [
          {
            ...entry,
            book: {
              ...entry.book,
              sections: [
                {
                  id: "section-1",
                  order: 0,
                  label: "段落 1",
                  kind: "text" as const,
                  text: "",
                  // The decoder places text before metadata; persistence emits metadata first.
                  textRange: { length: 4, end: entry.source!.size, start: 0 },
                },
              ],
            },
          },
        ],
      },
    };
    const [binding] = await restoreReaderTransfer(deferred, () => {});
    const original = getReaderState().library.find((book) => book.id === binding!.target)!;
    await expect(restoreReaderTransfer(deferred, () => {})).resolves.toEqual([binding]);
    expect(getReaderState().library.find((book) => book.id === original.id)).toBe(original);
    reader.replaceBook({
      ...original,
      sections: original.sections.map((section) => ({ ...section, label: "已修改" })),
    });
    await expect(restoreReaderTransfer(deferred, () => {})).rejects.toThrow("资料已修改");
  });

  it("retains distinct reviewed snapshots sharing the same source binary", async () => {
    const { prepared } = await setup();
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
    const entry = prepared.manifest.books[0]!;
    const another = {
      ...entry,
      book: {
        ...entry.book,
        id: "other",
        sections: entry.book.sections.map((section) => ({ ...section, text: "另一份已核对快照" })),
      },
    };
    const combined = { ...prepared, manifest: { ...prepared.manifest, books: [entry, another] } };
    const bindings = await restoreReaderTransfer(combined, () => {});
    expect(new Set(bindings.map((binding) => binding.target)).size).toBe(2);
    const books = getReaderState().library.filter((book) => book.preserveSectionSnapshot);
    expect(books.map((book) => book.sections[0]!.text)).toEqual(["恢复正文", "另一份已核对快照"]);
    reader.hydrate([books[0]!], {}, DEFAULT_READER_SETTINGS);
    reader.reconcileLibrary(books, {}, {}, null, {});
    expect(getReaderState().library.map((book) => book.id)).toEqual(books.map((book) => book.id));
    await restoreReaderTransfer(combined, () => {});
    expect(getReaderState().library).toHaveLength(2);
    // A later ordinary file import must not replace a cited research copy.
    expect(reader.addBook({ ...entry.book, source: books[0]!.source })).toBe(true);
    expect(getReaderState().library).toHaveLength(3);
    expect(getReaderState().library.filter((book) => book.preserveSectionSnapshot)).toEqual(books);
  });
});
