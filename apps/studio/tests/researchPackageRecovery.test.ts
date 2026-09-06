import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashReadableStream } from "@bcr/core";
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
} from "../src/researchPackageRecovery";
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
      if (key.includes("recovery") && JSON.parse(raw).phase === "reader-restored")
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
        if (key.includes("recovery") && JSON.parse(raw).phase === cut) throw new Error("crash");
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
      if (key.includes("recovery")) throw new Error("crash");
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
      if (key.includes("recovery") && JSON.parse(raw).phase === "complete")
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
      if (key.includes("recovery") && JSON.parse(raw).phase === "reader-restored")
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
