import { afterEach, describe, expect, it, vi } from "vitest";
import { contentHash } from "@bcr/core";
import type { ReaderBook } from "@bcr/reader-core";
import { createReaderRuntime, type ReaderRuntime } from "../src/readerRuntimeCore";
import { createDemoBook, DEFAULT_READER_SETTINGS } from "../src/model";
import { reader, getReaderState } from "../src/store";
import { persistReaderSnapshot, restoreReaderSnapshot } from "../src/readerPersistenceQueue";
import { restoreReader } from "../src/readerPersistence";
import { restoreReaderTransfer } from "../src/researchTransfer";
import type { PreparedReaderBackup } from "../src/readerBackup";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function book(id: string): ReaderBook {
  return {
    ...createDemoBook(),
    importedAt: 1,
    updatedAt: 1,
    id,
    title: id,
    sections: [
      { id: `${id}-section`, order: 0, label: id, kind: "text", text: "保存当前阅读位置和正文" },
    ],
  };
}
function backup(id = "incoming"): PreparedReaderBackup {
  const bytes = new TextEncoder().encode("迁移正文"),
    hash = contentHash(bytes);
  const item = {
    ...book(id),
    source: { name: `${id}.txt`, format: "txt" as const, mime: "text/plain", size: bytes.length },
  };
  return {
    manifest: {
      format: "bcr-reader-backup",
      version: 1,
      createdAt: 1,
      settings: DEFAULT_READER_SETTINGS,
      books: [{ book: item, source: { hash, path: `sources/${hash}`, size: bytes.length } }],
      progressByBook: {},
      bookmarksByBook: {},
      annotationsByBook: {},
    },
    sources: new Map([[`sources/${hash}`, new Blob([bytes])]]),
  };
}
async function setup() {
  const runtime = await createReaderRuntime();
  reader.hydrate([book("first"), book("current")], {}, DEFAULT_READER_SETTINGS);
  const local = new Map<string, string>(),
    metadata = new Map<string, string>();
  const hooks = {
    localFails: false,
    beforeWrite: async (_key: string, _raw: string) => {},
    active: 0,
    maxActive: 0,
  };
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => local.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (hooks.localFails) throw new Error("quota");
      local.set(key, value);
    },
  });
  runtime.meta = {
    kvGet: async (key: string) => metadata.get(key),
    kvSet: async (key: string, raw: string) => {
      hooks.active++;
      hooks.maxActive = Math.max(hooks.maxActive, hooks.active);
      try {
        await hooks.beforeWrite(key, raw);
        metadata.set(key, raw);
      } finally {
        hooks.active--;
      }
    },
  } as unknown as NonNullable<ReaderRuntime["meta"]>;
  return { runtime, hooks, local, metadata };
}
function pauseWrite(
  hooks: Awaited<ReturnType<typeof setup>>["hooks"],
  match: (key: string, raw: string) => boolean,
) {
  const entered = deferred(),
    released = deferred();
  let once = true;
  hooks.beforeWrite = async (key, raw) => {
    if (!once || !match(key, raw)) return;
    once = false;
    entered.resolve();
    await released.promise;
  };
  return { entered: entered.promise, release: released.resolve };
}
function editDuringWrite() {
  reader.addBook(book("added-locally"));
  reader.removeBook("first");
  reader.openBook("current");
  reader.setLocator({ kind: "section", sectionId: "current-section", progression: 0.6 }, 0.6);
  reader.setSettings({ fontSize: 24 });
  const hit = {
    bookId: "current",
    sectionId: "current-section",
    label: "current",
    snippet: "正文",
    score: 1,
    matchStart: 9,
    matchLength: 2,
  };
  reader.setSearch("正文", [hit], "current");
  reader.revealSearchHit(hit);
  return getReaderState();
}
afterEach(() => vi.unstubAllGlobals());

describe("Reader persistence queue", () => {
  it.each(["autosave", "restore"])(
    "serializes %s first and preserves edits made during its write",
    async (first) => {
      const { runtime, hooks, metadata } = await setup();
      const paused = pauseWrite(
        hooks,
        (key, raw) =>
          key === "reader/library" && (first === "autosave" || raw.includes("research-")),
      );
      const pending =
        first === "autosave"
          ? persistReaderSnapshot(runtime, { strict: true })
          : restoreReaderTransfer(backup(), () => {});
      await paused.entered;
      expect(getReaderState().library.some((item) => item.id.startsWith("research-"))).toBe(false);
      const live = editDuringWrite();
      const following =
        first === "autosave"
          ? restoreReaderTransfer(backup(), () => {})
          : persistReaderSnapshot(runtime, { strict: true });
      paused.release();
      await Promise.all([pending, following]);
      expect(hooks.maxActive).toBe(1);
      const latest = getReaderState();
      expect(latest.library).toHaveLength(3);
      expect(latest.library.some((item) => item.id === "first")).toBe(false);
      expect(latest.library.some((item) => item.id === "added-locally")).toBe(true);
      expect(latest.progressByBook).toBe(live.progressByBook);
      expect(latest.settings).toBe(live.settings);
      expect(latest.searchReveal).toBe(live.searchReveal);
      expect(latest.searchHits).toBe(live.searchHits);
      expect(latest.navigationHistory).toBe(live.navigationHistory);
      const reopened = await restoreReader(runtime);
      expect(reopened!.books.map((item) => item.id)).toEqual(latest.library.map((item) => item.id));
      expect(reopened!.progressByBook.current!.percentage).toBe(0.6);
      expect(reopened!.settings.fontSize).toBe(24);
      expect(reopened!.searchSession.query).toBe("正文");
      expect(
        JSON.parse(metadata.get("reader/library")!).books.map((item: ReaderBook) => item.id),
      ).toEqual(latest.library.map((item) => item.id));
    },
  );

  it("keeps background recovery from reading an uncommitted catalog", async () => {
    const { runtime, hooks } = await setup();
    const paused = pauseWrite(hooks, (key) => key === "reader/library");
    const writing = restoreReaderTransfer(backup(), () => {});
    await paused.entered;
    let readFinished = false;
    const reading = restoreReaderSnapshot(runtime).then((value) => {
      readFinished = true;
      return value;
    });
    await Promise.resolve();
    expect(readFinished).toBe(false);
    paused.release();
    await writing;
    const snapshot = await reading;
    expect(snapshot!.books.map((item) => item.id)).toEqual(
      getReaderState().library.map((item) => item.id),
    );
    expect(snapshot!.books).toHaveLength(3);
  });

  it("repairs partially written catalogs after failure and leaves the queue usable", async () => {
    const { runtime, hooks, local } = await setup();
    await persistReaderSnapshot(runtime, { strict: true });
    local.clear();
    hooks.localFails = true;
    let fail = true;
    hooks.beforeWrite = async (key) => {
      if (fail && key === "reader/session") {
        fail = false;
        throw new Error("disk failure");
      }
    };
    const original = getReaderState().library;
    await expect(restoreReaderTransfer(backup(), () => {})).rejects.toThrow("阅读记录未能保存");
    expect(getReaderState().library).toBe(original);
    expect((await restoreReader(runtime))!.books.map((item) => item.id)).toEqual(
      original.map((item) => item.id),
    );
    await persistReaderSnapshot(runtime, { strict: true });
    await restoreReaderTransfer(backup(), () => {});
    expect(getReaderState().library).toHaveLength(3);
    expect(getReaderState().saveError).toBeNull();
  });

  it("does not resurrect a reused book removed while another source is staged", async () => {
    const { runtime } = await setup();
    const original = backup();
    const [binding] = await restoreReaderTransfer(original, () => {});
    const next = backup("second-incoming");
    const combined = {
      ...original,
      manifest: {
        ...original.manifest,
        books: [...original.manifest.books, ...next.manifest.books],
      },
    };
    await expect(
      restoreReaderTransfer(combined, (message) => {
        if (message.includes("second-incoming")) reader.removeBook(binding!.target);
      }),
    ).rejects.toThrow("删除");
    await persistReaderSnapshot(runtime, { strict: true });
    expect(
      (await restoreReader(runtime))!.books.some((item) => item.id.startsWith("research-")),
    ).toBe(false);
  });

  it("reuses a concurrent import instead of publishing duplicate identities", async () => {
    const { hooks } = await setup();
    const paused = pauseWrite(hooks, (key) => key === "reader/library");
    const left = restoreReaderTransfer(backup(), () => {});
    await paused.entered;
    const right = restoreReaderTransfer(backup(), () => {});
    paused.release();
    expect(await left).toEqual(await right);
    expect(getReaderState().library.filter((item) => item.id.startsWith("research-"))).toHaveLength(
      1,
    );
    expect(hooks.maxActive).toBe(1);
  });

  it("rejects a reused source changed during commit and repairs the pending catalog", async () => {
    const { runtime, hooks } = await setup();
    const original = backup();
    const [binding] = await restoreReaderTransfer(original, () => {});
    const other = backup("second-incoming");
    const combined = {
      ...original,
      manifest: {
        ...original.manifest,
        books: [...original.manifest.books, ...other.manifest.books],
      },
    };
    const paused = pauseWrite(
      hooks,
      (key, raw) => key === "reader/library" && raw.includes("second-incoming"),
    );
    const restoring = restoreReaderTransfer(combined, () => {});
    await paused.entered;
    const existing = getReaderState().library.find((item) => item.id === binding!.target)!;
    reader.replaceBook({
      ...existing,
      updatedAt: existing.updatedAt + 1,
      sections: existing.sections.map((section) => ({ ...section, text: "刚刚核对后的新正文" })),
    });
    paused.release();
    await expect(restoring).rejects.toThrow("已修改");
    const reopened = await restoreReader(runtime);
    expect(reopened!.books.filter((item) => item.id.startsWith("research-"))).toHaveLength(1);
    expect(reopened!.books.find((item) => item.id === binding!.target)!.sections[0]!.text).toBe(
      "刚刚核对后的新正文",
    );
  });
});
