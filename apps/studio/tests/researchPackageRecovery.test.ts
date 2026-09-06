import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { textVersion, hashReadableStream } from "@bcr/core";
import { createReaderRuntime } from "@bcr/reader-studio/runtime";
import { reader, getReaderState } from "@bcr/reader-studio/store";
import { DEFAULT_READER_SETTINGS } from "@bcr/reader-studio/model";
import { Effect } from "effect";
import { decodeReaderBackup, readerTransferState } from "@bcr/reader-studio/research-transfer";
import { ResearchStore } from "../src/research";
import { createResearchBackup } from "../src/researchBackup";
import {
  decodeResearchRecovery,
  readResearchRecovery,
  resumeResearchRecovery,
  verifyRecoveryPackage,
  clearResearchRecovery,
  compactCompletedRecovery,
} from "../src/researchPackageRecovery";
import {
  saveRecoverySnapshot,
  saveRecoveryProgress,
  loadRecoverySnapshot,
} from "../src/researchRecoveryJournal";
import type { PreparedResearchPackage } from "../src/researchPackage";

async function fixture(): Promise<PreparedResearchPackage> {
  const blob = new Blob(["recovery source"]);
  const hash = await hashReadableStream(blob.stream());
  const path = `sources/${hash}`;
  return {
    backup: createResearchBackup(
      { version: 1, collections: [{ id: "c", name: "Original", excerpts: [] }] },
      false,
      { getItem: () => null },
    ),
    reader: {
      manifest: decodeReaderBackup({
        format: "bcr-reader-backup",
        version: 1,
        createdAt: 1,
        settings: DEFAULT_READER_SETTINGS,
        progressByBook: {},
        bookmarksByBook: {},
        annotationsByBook: {},
        books: [
          {
            book: {
              id: "old",
              title: "Source",
              source: { name: "source.txt", format: "txt", mime: "text/plain", size: blob.size },
              sections: [
                { id: "s", kind: "text", order: 0, label: "section", text: "recovery source" },
              ],
              importedAt: 1,
              updatedAt: 1,
              tags: [],
            },
            source: { path, hash, size: blob.size },
          },
        ],
      }),
      sources: new Map([[path, blob]]),
    },
  };
}
function storage() {
  const data = new Map<string, string>();
  const metadata = {
    get: async (key: string) => data.get(key),
    set: async (key: string, raw: string) => {
      data.set(key, raw);
    },
  };
  return { data, metadata, store: new ResearchStore(metadata) };
}
beforeEach(async () => {
  await createReaderRuntime();
  reader.hydrate([], {}, DEFAULT_READER_SETTINGS);
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("research import recovery", () => {
  it("requires a durable journal before writing Reader data", async () => {
    const { store, metadata } = storage();
    vi.spyOn(metadata, "set").mockRejectedValue(new Error("quota"));
    await expect(resumeResearchRecovery(store, () => {}, await fixture())).rejects.toThrow("quota");
    expect(getReaderState().library.filter((book) => book.id.startsWith("research-"))).toHaveLength(
      0,
    );
  });
  it("resumes from staged sources after Reader committed but the journal did not advance", async () => {
    const { store, metadata } = storage();
    const original = metadata.set;
    vi.spyOn(metadata, "set").mockImplementation(async (key, raw) => {
      if (
        key === "workspace/research-package-recovery.v1" &&
        JSON.parse(raw).phase === "reader-restored"
      )
        throw new Error("crash");
      await original(key, raw);
    });
    await expect(resumeResearchRecovery(store, () => {}, await fixture())).rejects.toThrow("crash");
    expect(getReaderState().library.filter((book) => book.id.startsWith("research-"))).toHaveLength(
      1,
    );
    expect((await readResearchRecovery(store))?.phase).toBe("pending");
    vi.restoreAllMocks();
    const reopened = new ResearchStore(metadata);
    await resumeResearchRecovery(reopened, () => {});
    expect(getReaderState().library.filter((book) => book.id.startsWith("research-"))).toHaveLength(
      1,
    );
    expect(reopened.getSnapshot().collections).toHaveLength(1);
    expect((await readResearchRecovery(reopened))?.phase).toBe("complete");
  });
  it.each(["write-then-throw", "collections-merged", "complete"])(
    "preserves later edits and deletions when interrupted at %s",
    async (cut) => {
      const { store, metadata } = storage();
      const original = metadata.set;
      vi.spyOn(metadata, "set").mockImplementation(async (key, raw) => {
        if (cut === "write-then-throw" && key === "workspace/research.v1") {
          await original(key, raw);
          throw new Error("crash");
        }
        if (key === "workspace/research-package-recovery.v1" && JSON.parse(raw).phase === cut)
          throw new Error("crash");
        await original(key, raw);
      });
      await expect(resumeResearchRecovery(store, () => {}, await fixture())).rejects.toThrow(
        "crash",
      );
      vi.restoreAllMocks();
      const reopened = new ResearchStore(metadata);
      await reopened.update((current) => ({
        ...current,
        collections: current.collections.map((c) => ({ ...c, name: "User edit" })),
      }));
      await resumeResearchRecovery(reopened, () => {});
      expect(reopened.getSnapshot().collections.map((c) => c.name)).toEqual(["User edit"]);
      expect(Object.keys(reopened.getSnapshot())).toEqual(["version", "collections"]);
      await reopened.update(() => ({ version: 1, collections: [] }));
      await resumeResearchRecovery(reopened, () => {});
      expect(reopened.getSnapshot().collections).toHaveLength(0);
    },
  );
  it("requires the same package when staged files are absent and serializes retries", async () => {
    const { store, metadata } = storage();
    const prepared = await fixture();
    const original = metadata.set;
    vi.spyOn(metadata, "set").mockImplementation(async (key, raw) => {
      await original(key, raw);
      if (key === "workspace/research-package-recovery.v1") throw new Error("crash");
    });
    await expect(resumeResearchRecovery(store, () => {}, prepared)).rejects.toThrow("crash");
    vi.restoreAllMocks();
    await expect(resumeResearchRecovery(store, () => {})).rejects.toThrow("重新选择同一");
    await expect(
      resumeResearchRecovery(store, () => {}, {
        ...prepared,
        backup: { ...prepared.backup, createdAt: 999 },
      }),
    ).rejects.toThrow("同一资料包");
    expect(getReaderState().library.filter((book) => book.id.startsWith("research-"))).toHaveLength(
      0,
    );
    await Promise.all([
      resumeResearchRecovery(store, () => {}, prepared),
      resumeResearchRecovery(store, () => {}),
    ]);
    expect(getReaderState().library.filter((book) => book.id.startsWith("research-"))).toHaveLength(
      1,
    );
    expect(store.getSnapshot().collections).toHaveLength(1);
  });
  it("does not reintroduce a collection deleted before the journal completes", async () => {
    const { store, metadata } = storage();
    const original = metadata.set;
    vi.spyOn(metadata, "set").mockImplementation(async (key, raw) => {
      if (key === "workspace/research-package-recovery.v1" && JSON.parse(raw).phase === "complete")
        throw new Error("crash");
      await original(key, raw);
    });
    await expect(resumeResearchRecovery(store, () => {}, await fixture())).rejects.toThrow("crash");
    vi.restoreAllMocks();
    const reopened = new ResearchStore(metadata);
    await reopened.update(() => ({
      version: 1,
      collections: [{ id: "local", name: "New local collection", excerpts: [] }],
    }));
    await resumeResearchRecovery(reopened, () => {});
    expect(reopened.getSnapshot().collections.map((c) => c.id)).toEqual(["local"]);
  });
  it("requires reselection to repair a corrupted staged source without duplicating books", async () => {
    const { store, metadata } = storage();
    const prepared = await fixture();
    const original = metadata.set;
    vi.spyOn(metadata, "set").mockImplementation(async (key, raw) => {
      if (
        key === "workspace/research-package-recovery.v1" &&
        JSON.parse(raw).phase === "reader-restored"
      )
        throw new Error("crash");
      await original(key, raw);
    });
    await expect(resumeResearchRecovery(store, () => {}, prepared)).rejects.toThrow("crash");
    vi.restoreAllMocks();
    const ref = getReaderState().library.find((book) => book.id.startsWith("research-"))!.source
      .ref!;
    await Effect.runPromise(
      readerTransferState().runtime.artifacts.putStream(
        { ...ref, type: "file/publication", format: ref.mime },
        new Blob(["corrupt"]).stream(),
      ),
    );
    await expect(resumeResearchRecovery(store, () => {})).rejects.toThrow("缺失或损坏");
    expect(store.getSnapshot().collections).toHaveLength(0);
    await resumeResearchRecovery(store, () => {}, prepared);
    expect(getReaderState().library.filter((book) => book.id.startsWith("research-"))).toHaveLength(
      1,
    );
    expect(store.getSnapshot().collections).toHaveLength(1);
  });
  it.each(["delete", "edit", "missing-source"])(
    "only finalizes a committed import after a later Reader %s",
    async (change) => {
      const { store, metadata } = storage();
      const prepared = await fixture();
      const original = metadata.set;
      vi.spyOn(metadata, "set").mockImplementation(async (key, raw) => {
        if (key === "workspace/research.v1") {
          await original(key, raw);
          throw new Error("committed before crash");
        }
        await original(key, raw);
      });
      await expect(resumeResearchRecovery(store, () => {}, prepared)).rejects.toThrow(
        "committed before crash",
      );
      vi.restoreAllMocks();
      const book = getReaderState().library.find((book) => book.id.startsWith("research-"))!;
      if (change === "delete") reader.removeBook(book.id);
      if (change === "edit")
        reader.hydrate(
          getReaderState().library.map((item) =>
            item.id === book.id
              ? {
                  ...item,
                  sections: item.sections.map((section) => ({
                    ...section,
                    text: "User changed body",
                  })),
                }
              : item,
          ),
          {},
          DEFAULT_READER_SETTINGS,
        );
      if (change === "missing-source") {
        const ref = book.source.ref!;
        await Effect.runPromise(
          readerTransferState().runtime.artifacts.delete({
            ...ref,
            type: "file/publication",
            format: ref.mime,
          }),
        );
      }
      const before = getReaderState();
      const files = vi.spyOn(readerTransferState().runtime.artifacts, "getBlob");
      expect(await resumeResearchRecovery(store, () => {})).toBe("finalized");
      expect(getReaderState()).toBe(before);
      expect(files).not.toHaveBeenCalled();
      expect((await readResearchRecovery(store))?.phase).toBe("complete");
      expect(store.getSnapshot().collections).toHaveLength(1);
    },
  );
  it("does not treat a journal phase as proof that collections committed", async () => {
    const { store, metadata, data } = storage();
    const original = metadata.set;
    vi.spyOn(metadata, "set").mockImplementation(async (key, raw) => {
      if (key === "workspace/research-package-recovery.v1" && JSON.parse(raw).phase === "complete")
        throw new Error("crash");
      await original(key, raw);
    });
    await expect(resumeResearchRecovery(store, () => {}, await fixture())).rejects.toThrow("crash");
    vi.restoreAllMocks();
    data.set("workspace/research.v1", JSON.stringify({ version: 1, collections: [] }));
    expect(await resumeResearchRecovery(store, () => {})).toBe("restored");
    expect(store.getSnapshot().collections).toHaveLength(1);
  });
  it("rejects a different package during inspection without changing the source catalog", async () => {
    const { store, metadata, data } = storage();
    const prepared = await fixture();
    const original = metadata.set;
    vi.spyOn(metadata, "set").mockImplementation(async (key, raw) => {
      await original(key, raw);
      if (key === "workspace/research-package-recovery.v1") throw new Error("crash");
    });
    await expect(resumeResearchRecovery(store, () => {}, prepared)).rejects.toThrow("crash");
    vi.restoreAllMocks();
    await store.writePackageRecord("restore", "existing catalog");
    const before = new Map(data);
    await expect(
      verifyRecoveryPackage(store, { ...prepared, backup: { ...prepared.backup, createdAt: 999 } }),
    ).rejects.toThrow("同一资料包");
    await expect(verifyRecoveryPackage(store, prepared)).resolves.toBeUndefined();
    expect(data).toEqual(before);
  });
  it("writes the snapshot once and keeps stage updates small for large chapter snapshots", async () => {
    const { store, metadata } = storage();
    const prepared = await fixture();
    const manifest = {
      ...prepared.reader.manifest,
      books: prepared.reader.manifest.books.map((entry) => ({
        ...entry,
        book: {
          ...entry.book,
          sections: entry.book.sections.map((section) => ({
            ...section,
            text: "x".repeat(1024 * 1024),
          })),
        },
      })),
    };
    const writes = vi.spyOn(metadata, "set");
    let progress = await saveRecoverySnapshot(
      store,
      { id: "large", identity: textVersion("large"), phase: "pending" },
      { backup: prepared.backup, manifest },
    );
    for (const phase of ["reader-restored", "collections-merged", "complete"] as const)
      progress = await saveRecoveryProgress(store, progress, phase);
    expect(writes.mock.calls.filter(([key]) => key.includes("recovery-snapshot"))).toHaveLength(1);
    const stages = writes.mock.calls.filter(
      ([key]) => key === "workspace/research-package-recovery.v1",
    );
    expect(stages).toHaveLength(4);
    expect(stages.every(([, raw]) => new Blob([raw]).size < 1024)).toBe(true);
    const reads = vi.spyOn(metadata, "get");
    expect((await readResearchRecovery(store))?.phase).toBe("complete");
    expect(reads.mock.calls.some(([key]) => key.includes("snapshot"))).toBe(false);
  });
  it.each([false, true])(
    "never starts Reader when the initial snapshot write fails (committed: %s)",
    async (committed) => {
      const { store, metadata } = storage();
      const original = metadata.set;
      vi.spyOn(metadata, "set").mockImplementation(async (key, raw) => {
        if (key.includes("recovery-snapshot")) {
          if (committed) await original(key, raw);
          throw new Error("snapshot crash");
        }
        await original(key, raw);
      });
      const prepared = await fixture();
      await expect(resumeResearchRecovery(store, () => {}, prepared)).rejects.toThrow(
        "snapshot crash",
      );
      expect(await readResearchRecovery(store)).toBeUndefined();
      expect(getReaderState().library.some((book) => book.id.startsWith("research-"))).toBe(false);
      vi.restoreAllMocks();
      await resumeResearchRecovery(store, () => {}, prepared);
      expect(await store.readPackageRecord("recovery-snapshot")).toBe("");
    },
  );
  it.each(["snapshot-before", "snapshot-after", "progress-before", "progress-after"])(
    "resumes a legacy journal interrupted during migration at %s",
    async (cut) => {
      const { store, metadata } = storage();
      const prepared = await fixture();
      const legacy = {
        version: 1,
        id: "legacy",
        identity: textVersion(
          JSON.stringify([prepared.backup, prepared.reader.manifest.books, prepared.volume]),
        ),
        phase: "pending",
        backup: prepared.backup,
        manifest: prepared.reader.manifest,
      };
      await store.writePackageRecord(
        "recovery",
        JSON.stringify({ ...legacy, checksum: textVersion(JSON.stringify(legacy)) }),
      );
      const original = metadata.set;
      vi.spyOn(metadata, "set").mockImplementation(async (key, raw) => {
        const targeted = cut.startsWith("snapshot")
          ? key.includes("recovery-snapshot")
          : key === "workspace/research-package-recovery.v1";
        if (targeted) {
          if (cut.endsWith("after")) await original(key, raw);
          throw new Error("migration crash");
        }
        await original(key, raw);
      });
      await expect(resumeResearchRecovery(store, () => {}, prepared)).rejects.toThrow(
        "migration crash",
      );
      expect(getReaderState().library.some((book) => book.id.startsWith("research-"))).toBe(false);
      expect((await readResearchRecovery(store))?.version).toBe(cut === "progress-after" ? 2 : 1);
      vi.restoreAllMocks();
      await resumeResearchRecovery(new ResearchStore(metadata), () => {}, prepared);
      expect((await readResearchRecovery(store))?.version).toBe(2);
      expect((await readResearchRecovery(store))?.phase).toBe("complete");
      expect(await store.readPackageRecord("recovery-snapshot")).toBe("");
    },
  );
  it.each(["missing", "corrupt", "wrong-task"])(
    "rejects a %s snapshot before Reader writes",
    async (damage) => {
      const { store } = storage();
      const prepared = await fixture();
      const progress = await saveRecoverySnapshot(
        store,
        { id: "owner", identity: textVersion("owner"), phase: "pending" },
        { backup: prepared.backup, manifest: prepared.reader.manifest },
      );
      if (damage === "missing") await store.writePackageRecord("recovery-snapshot", "");
      if (damage === "corrupt") await store.writePackageRecord("recovery-snapshot", "broken");
      const record = damage === "wrong-task" ? { ...progress, id: "another" } : progress;
      await expect(loadRecoverySnapshot(store, record)).rejects.toThrow("恢复快照");
      expect(getReaderState().library.some((book) => book.id.startsWith("research-"))).toBe(false);
    },
  );
  it("retains completion when snapshot cleanup fails and retries cleanup without replay", async () => {
    const { store, metadata } = storage();
    const original = metadata.set;
    vi.spyOn(metadata, "set").mockImplementation(async (key, raw) => {
      if (key.includes("recovery-snapshot") && raw === "") throw new Error("cleanup crash");
      await original(key, raw);
    });
    expect(await resumeResearchRecovery(store, () => {}, await fixture())).toBe("restored");
    expect((await readResearchRecovery(store))?.phase).toBe("complete");
    expect(await store.readPackageRecord("recovery-snapshot")).toBeTruthy();
    vi.restoreAllMocks();
    const before = getReaderState();
    expect(await resumeResearchRecovery(store, () => {})).toBe("complete");
    expect(getReaderState()).toBe(before);
    expect(await store.readPackageRecord("recovery-snapshot")).toBe("");
    await clearResearchRecovery(store);
    expect(await readResearchRecovery(store)).toBeUndefined();
  });
  it("compacts completed legacy logs and leaves a newer pending task intact", async () => {
    const { store } = storage();
    const prepared = await fixture();
    const legacy = {
      version: 1,
      id: "finished",
      identity: textVersion("finished"),
      phase: "complete",
      backup: prepared.backup,
      manifest: prepared.reader.manifest,
    };
    await store.writePackageRecord(
      "recovery",
      JSON.stringify({ ...legacy, checksum: textVersion(JSON.stringify(legacy)) }),
    );
    const before = getReaderState();
    await compactCompletedRecovery(store);
    const summary = await readResearchRecovery(store);
    expect(summary?.version).toBe(2);
    expect(summary?.phase).toBe("complete");
    expect(JSON.stringify(summary)).not.toContain("manifest");
    expect(getReaderState()).toBe(before);
    await saveRecoverySnapshot(
      store,
      { id: "new", identity: textVersion("new"), phase: "pending" },
      { backup: prepared.backup, manifest: prepared.reader.manifest },
    );
    const snapshot = await store.readPackageRecord("recovery-snapshot");
    await compactCompletedRecovery(store);
    expect(await store.readPackageRecord("recovery-snapshot")).toBe(snapshot);
    expect((await readResearchRecovery(store))?.phase).toBe("pending");
  });
  it("rejects damaged journals without replacing them", async () => {
    const { store } = storage();
    await store.writePackageRecord("recovery", '{"version":1}');
    await expect(decodeResearchRecovery('{"version":1}')).rejects.toThrow("日志损坏");
    await expect(resumeResearchRecovery(store, () => {}, await fixture())).rejects.toThrow(
      "日志损坏",
    );
    expect(getReaderState().library.filter((book) => book.id.startsWith("research-"))).toHaveLength(
      0,
    );
  });
});
