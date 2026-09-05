import { describe, expect, it } from "vitest";
import { Context, Effect, Layer } from "effect";
import { artifactStore, ArtifactStoreTag, contentHash } from "@bcr/core";
import { MemoryStore } from "@bcr/storage-opfs";
import { BlobReader, BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";
import {
  backupNewBooks,
  createReaderBackup,
  decodeReaderBackup,
  inspectReaderBackup,
  prepareReaderRestore,
} from "../src/readerBackup";
import { createDemoBook, DEFAULT_READER_SETTINGS } from "../src/model";
import { getReaderState } from "../src/store";
import type { ReaderRuntime } from "../src/runtime";
import { persistReader, restoreNavigationHistory } from "../src/readerPersistence";

const book = {
  ...createDemoBook(),
  sections: createDemoBook().sections.map(({ html: _html, ...section }) => section),
};
const manifest = () => ({
  format: "bcr-reader-backup",
  version: 1,
  createdAt: 1,
  books: [{ book }],
  settings: DEFAULT_READER_SETTINGS,
  progressByBook: {},
  bookmarksByBook: {},
  annotationsByBook: {},
});
async function runtime(): Promise<ReaderRuntime> {
  const binary = new MemoryStore();
  const context = await Effect.runPromise(
    Effect.scoped(Layer.build(artifactStore({ opfs: binary, memory: binary }))),
  );
  return {
    binary,
    artifacts: Context.get(context, ArtifactStoreTag),
    ftsReady: false,
    meta: undefined,
    indexSession: undefined,
    parseSession: undefined,
    parserMode: "main",
  };
}

describe("Reader portable backup", () => {
  it("keeps nested publication navigation in the validated projection", () => {
    const toc = [
      {
        id: "part",
        label: "Part",
        children: [{ id: "chapter", label: "Chapter", sectionId: book.sections[0]!.id }],
      },
    ];
    expect(
      decodeReaderBackup({ ...manifest(), books: [{ book: { ...book, toc } }] }).books[0]?.book.toc,
    ).toEqual(toc);
  });

  it("reports a storage failure instead of returning a successful save", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        setItem: () => {
          throw new Error("quota");
        },
      },
    });
    try {
      await expect(
        persistReader(await runtime(), { ...getReaderState(), library: [book] }),
      ).rejects.toThrow("未能保存");
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
      else Reflect.deleteProperty(globalThis, "localStorage");
    }
  });

  it("validates persisted jump history and drops removed books or sections", () => {
    const valid = {
      bookId: book.id,
      locator: { kind: "section", sectionId: book.sections[0]!.id, progression: 0.3 },
    };
    const restored = restoreNavigationHistory([book], {
      back: [
        valid,
        { ...valid, bookId: "removed" },
        { ...valid, locator: { ...valid.locator, sectionId: "missing" } },
      ],
      forward: [],
    });
    expect(restored.back).toEqual([valid]);
    expect(restoreNavigationHistory([book], { back: Array(60).fill(valid) }).back).toHaveLength(50);
  });
  it("round-trips sources, notes and semantic progress into an independent store", async () => {
    const source = await runtime();
    const bytes = new TextEncoder().encode("A portable publication");
    const hash = contentHash(bytes);
    const ref = {
      id: `reader/${hash}`,
      type: "file/publication",
      storage: "memory" as const,
      hash,
      format: "text/plain",
    };
    await Effect.runPromise(source.artifacts.put(ref, bytes));
    const publication = {
      ...book,
      source: {
        name: "portable.txt",
        format: "txt" as const,
        mime: "text/plain",
        size: bytes.length,
        ref: { ...ref, mime: "text/plain", size: bytes.length },
      },
    };
    const locator = { kind: "section" as const, sectionId: book.sections[1]!.id, progression: 0.4 };
    const state = {
      ...getReaderState(),
      library: [publication],
      progressByBook: { [book.id]: { locator, percentage: 0.4, updatedAt: 2 } },
      annotationsByBook: {
        [book.id]: [
          { id: "note", note: "Keep me", label: "Note", locator, createdAt: 1, updatedAt: 2 },
        ],
      },
    };
    const zip = await createReaderBackup(source, state);
    const inspected = await inspectReaderBackup(zip);
    expect(inspected.sources.size).toBe(1);
    expect(inspected.manifest.annotationsByBook[book.id]?.[0]?.note).toBe("Keep me");
    expect(inspected.manifest.progressByBook[book.id]?.locator).toEqual(locator);
    const target = await runtime();
    const restored = await prepareReaderRestore(target, inspected, []);
    expect(restored[0]?.id).toBe(book.id);
    expect(await Effect.runPromise(target.artifacts.get(ref))).toEqual(bytes);
    expect(backupNewBooks(inspected, restored)).toHaveLength(0);
    expect(backupNewBooks(inspected, [{ ...restored[0]!, id: "other-id" }])).toHaveLength(0);
  });

  it("rejects unknown versions, duplicate ids, unsafe ids and invalid preferences", () => {
    expect(() => decodeReaderBackup({ ...manifest(), version: 2 })).toThrow();
    expect(() => decodeReaderBackup({ ...manifest(), books: [{ book }, { book }] })).toThrow();
    expect(() =>
      decodeReaderBackup({ ...manifest(), books: [{ book: { ...book, id: "__proto__" } }] }),
    ).toThrow();
    expect(() =>
      decodeReaderBackup({ ...manifest(), settings: { ...DEFAULT_READER_SETTINGS, fontSize: -1 } }),
    ).toThrow();
  });

  it("rejects missing or tampered source files before restoring anything", async () => {
    const bytes = new TextEncoder().encode("correct");
    const hash = contentHash(bytes);
    const payload = {
      ...manifest(),
      books: [{ book, source: { path: `sources/${hash}`, hash, size: bytes.length } }],
    };
    const zip = new ZipWriter(new BlobWriter());
    await zip.add("reader.json", new TextReader(JSON.stringify(payload)));
    await zip.add(`sources/${hash}`, new BlobReader(new Blob(["changed"])));
    await expect(inspectReaderBackup(await zip.close())).rejects.toThrow("校验失败");
    const missing = new ZipWriter(new BlobWriter());
    await missing.add("reader.json", new TextReader(JSON.stringify(payload)));
    await expect(inspectReaderBackup(await missing.close())).rejects.toThrow("缺失");
  });

  it("honors cancellation and never returns an incomplete backup", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      createReaderBackup(
        await runtime(),
        { ...getReaderState(), library: [book] },
        undefined,
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
