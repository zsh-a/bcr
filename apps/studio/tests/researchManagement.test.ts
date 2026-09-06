import { describe, expect, it } from "vitest";
import { ResearchStore, type ResearchLibrary, type ResearchExcerpt } from "../src/research";
import {
  renameCollection,
  deleteCollection,
  moveExcerpt,
  readDraft,
  writeDraft,
  clearDraft,
  draftKey,
  draftFailed,
  pruneDrafts,
} from "../src/researchManagement";
const excerpt: ResearchExcerpt = {
  id: "entry",
  documentId: "reader:1",
  title: "Title",
  source: "Reader",
  route: "/reader?book=1",
  text: "source snapshot",
  note: "saved note",
  savedAt: 1,
};
const library: ResearchLibrary = {
  version: 1,
  collections: [
    { id: "a", name: "A", excerpts: [excerpt] },
    { id: "b", name: "B", excerpts: [] },
  ],
};
function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}
describe("research management", () => {
  it("renames and deletes only the selected collection", () => {
    const renamed = renameCollection(library, "a", " New name ");
    expect(renamed.collections[0]?.name).toBe("New name");
    expect(renamed.collections[0]?.excerpts[0]).toBe(excerpt);
    expect(deleteCollection(renamed, "a").collections).toEqual([library.collections[1]]);
    expect(() => renameCollection(library, "a", " ")).toThrow();
    expect(() => renameCollection(library, "missing", "Name")).toThrow();
  });
  it("moves the complete snapshot atomically and rejects collisions", () => {
    const moved = moveExcerpt(library, "a", "b", excerpt.id);
    expect(moved.collections[0]?.excerpts).toEqual([]);
    expect(moved.collections[1]?.excerpts[0]).toBe(excerpt);
    expect(library.collections[0]?.excerpts).toEqual([excerpt]);
    expect(() => moveExcerpt(library, "a", "missing", excerpt.id)).toThrow();
    expect(() =>
      moveExcerpt(
        {
          ...library,
          collections: [
            library.collections[0]!,
            { ...library.collections[1]!, excerpts: [{ ...excerpt, id: "duplicate" }] },
          ],
        },
        "a",
        "b",
        excerpt.id,
      ),
    ).toThrow("已有");
  });
  it("keeps the original library after a failed move and permits retry", async () => {
    let raw = JSON.stringify(library),
      fail = true;
    const metadata = {
      get: async () => raw,
      set: async (_: string, next: string) => {
        if (fail) throw new Error("disk full");
        raw = next;
      },
    };
    const store = new ResearchStore(metadata);
    await store.ready;
    await expect(
      store.update((current) => moveExcerpt(current, "a", "b", excerpt.id)),
    ).rejects.toThrow();
    expect(store.getSnapshot()).toEqual(library);
    fail = false;
    await store.update((current) => moveExcerpt(current, "a", "b", excerpt.id));
    const restored = new ResearchStore(metadata);
    await restored.ready;
    expect(restored.getSnapshot().collections[1]?.excerpts).toEqual([excerpt]);
  });
  it("recovers persisted drafts and keeps identity across moves", () => {
    const disk = storage();
    const item = { ...excerpt, id: "restore" };
    disk.setItem(draftKey(item), "recovered draft");
    expect(readDraft(item, disk)).toBe("recovered draft");
    writeDraft(item, "edited", disk);
    expect(readDraft({ ...item }, disk)).toBe("edited");
    clearDraft(item, "edited", disk);
    expect(readDraft({ ...item, note: "edited" }, disk)).toBe("edited");
    expect(disk.getItem(draftKey(item))).toBeNull();
  });
  it("retains failed draft writes in memory and never clears newer edits", () => {
    const disk = storage(),
      item = { ...excerpt, id: "failure" };
    expect(() =>
      writeDraft(item, "first", {
        setItem: () => {
          throw new Error("quota");
        },
      }),
    ).toThrow();
    expect(readDraft(item, disk)).toBe("first");
    expect(draftFailed(item)).toBe(true);
    writeDraft(item, "newer", disk);
    expect(draftFailed(item)).toBe(false);
    clearDraft(item, "first", disk);
    expect(readDraft(item, disk)).toBe("newer");
    clearDraft(item, "newer", disk);
  });
  it("cleans only orphan drafts and keeps moved or live drafts", () => {
    const disk = storage();
    const removed = { ...excerpt, id: "removed" };
    writeDraft(removed, "obsolete", disk);
    writeDraft(excerpt, "keep", disk);
    const keys = [draftKey(removed), draftKey(excerpt), "unrelated"];
    disk.setItem("unrelated", "value");
    pruneDrafts(moveExcerpt(library, "a", "b", excerpt.id), {
      ...disk,
      length: keys.length,
      key: (i) => keys[i] ?? null,
    });
    expect(disk.getItem(draftKey(removed))).toBeNull();
    expect(readDraft(removed, disk)).toBe(removed.note);
    expect(readDraft(excerpt, disk)).toBe("keep");
    expect(disk.getItem("unrelated")).toBe("value");
    clearDraft(excerpt, "keep", disk);
  });
  it("reports cleanup failure and allows a later retry", () => {
    const item = { ...excerpt, id: "cleanup-failure" },
      disk = storage();
    writeDraft(item, "draft", disk);
    const keys = { length: 1, key: () => draftKey(item) };
    expect(() =>
      pruneDrafts(library, {
        ...keys,
        removeItem: () => {
          throw new Error("blocked");
        },
      }),
    ).toThrow("清理");
    expect(disk.getItem(draftKey(item))).toBe("draft");
    pruneDrafts(library, { ...keys, removeItem: disk.removeItem });
    expect(disk.getItem(draftKey(item))).toBeNull();
  });
});
