import { describe, expect, it, vi } from "vitest";
import { KnowledgeStore } from "../src/knowledge/session/store";
import { newNote, pendingCount, type KnowledgeNote } from "../src/knowledge/session/model";
import { resolveKnowledgeConflict, mergeConflictNote } from "../src/knowledge/sync/conflicts";

async function conflicted() {
  const data = new Map<string, string>();
  let fail = false;
  const metadata = {
    get: async (key: string) => data.get(key),
    set: async (key: string, value: string) => {
      if (fail) throw new Error("disk full");
      data.set(key, value);
    },
  };
  const store = new KnowledgeStore(metadata);
  const base = { ...newNote("原笔记"), id: "merge-note", body: "共同正文", tags: [] };
  const local = { ...base, title: "本机标题", body: "本机改写" };
  const remote = { ...base, title: "远端标题", body: "远端改写", tags: ["远端标签"] };
  await store.saveNote(local, null);
  await store.integrate(
    { notes: { [base.id]: remote }, collections: {}, folders: [] },
    "a".repeat(40),
    { notes: { [base.id]: base }, collections: {}, folders: [] },
  );
  const conflict = store.getSnapshot().conflicts[0]!;
  return {
    store,
    metadata,
    local,
    remote,
    conflict,
    fail: (value: boolean) => {
      fail = value;
    },
  };
}

describe("atomic editable conflict merges", () => {
  it("saves an overlapping manual result, both originals and conflict removal together", async () => {
    const { store, metadata, local, remote, conflict } = await conflicted();
    const merged = mergeConflictNote(
      conflict.base as KnowledgeNote,
      local,
      remote,
      "双方整理后的正文",
    )!;
    const observed: { body: string; conflicts: number }[] = [];
    const unsubscribe = store.subscribe(() =>
      observed.push({
        body: store.getSnapshot().notes[local.id]!.body,
        conflicts: store.getSnapshot().conflicts.length,
      }),
    );
    await resolveKnowledgeConflict(store, conflict, "merge", merged);
    expect(observed).toEqual([{ body: "双方整理后的正文", conflicts: 0 }]);
    expect(store.getSnapshot().notes[local.id]).toMatchObject({
      title: local.title,
      body: merged.body,
      tags: remote.tags,
    });
    expect(store.getSnapshot().notes[local.id]!.path).toBeUndefined();
    expect(store.getSnapshot().history.map((entry) => entry.note.body)).toEqual(
      expect.arrayContaining([local.body, remote.body]),
    );
    expect(pendingCount(store.getSnapshot())).toBe(1);
    unsubscribe();
    await store.close();
    const reopened = new KnowledgeStore(metadata);
    await reopened.ready;
    expect(reopened.getSnapshot().notes[local.id]!.body).toBe(merged.body);
    expect(reopened.getSnapshot().conflicts).toEqual([]);
    expect(reopened.getSnapshot().history.map((entry) => entry.note.body)).toEqual(
      expect.arrayContaining([local.body, remote.body]),
    );
    await reopened.close();
  });

  it("retains the original conflict after a failed write and safely retries the same draft", async () => {
    const { store, metadata, local, conflict, fail } = await conflicted();
    const before = store.getSnapshot();
    const merged = { ...local, body: "尚未成功保存的合并草稿" };
    fail(true);
    await expect(resolveKnowledgeConflict(store, conflict, "merge", merged)).rejects.toThrow(
      "disk full",
    );
    expect(store.getSnapshot()).toBe(before);
    const reopened = new KnowledgeStore(metadata);
    await reopened.ready;
    expect(reopened.getSnapshot().notes[local.id]!.body).toBe(local.body);
    expect(reopened.getSnapshot().conflicts).toEqual([conflict]);
    expect(reopened.getSnapshot().history).toEqual(before.history);
    await reopened.close();
    fail(false);
    await resolveKnowledgeConflict(store, conflict, "merge", merged);
    expect(store.getSnapshot().notes[local.id]!.body).toBe(merged.body);
    await expect(resolveKnowledgeConflict(store, conflict, "merge", merged)).rejects.toThrow(
      "冲突已变化",
    );
    await store.close();
  });

  it("accepts an intentionally empty body", async () => {
    const { store, local, conflict } = await conflicted();
    await resolveKnowledgeConflict(store, conflict, "merge", { ...local, body: "" });
    expect(store.getSnapshot().notes[local.id]!.body).toBe("");
    expect(store.getSnapshot().conflicts).toEqual([]);
    await store.close();
  });

  it("retains the remote original when the saved merge equals that version exactly", async () => {
    const { store, local, remote, conflict } = await conflicted();
    const remoteVersion = { ...remote, title: local.title };
    const current = { ...conflict, remote: remoteVersion };
    await store.update((state) => ({ ...state, conflicts: [current] }));
    const now = vi.spyOn(Date, "now").mockReturnValue(remoteVersion.updatedAt);
    try {
      await store.resolve(current, "merge", { ...local, body: remote.body });
      expect(store.getSnapshot().notes[local.id]).toEqual(remoteVersion);
      expect(store.getSnapshot().history.map((entry) => entry.note.body)).toEqual(
        expect.arrayContaining([local.body, remote.body]),
      );
    } finally {
      now.mockRestore();
      await store.close();
    }
  });

  it("rejects changed conflicts and invalid identities or content before any state change", async () => {
    const { store, local, conflict } = await conflicted();
    const before = store.getSnapshot();
    await expect(
      store.resolve({ ...conflict, remote: { ...local, body: "更新的远端" } }, "merge", local),
    ).rejects.toThrow("冲突已变化");
    for (const extra of [
      { id: "forged-note" },
      { title: "绕过改名" },
      { path: "绕过移动.md" },
      { body: "a".repeat(500_001) },
    ]) {
      await expect(store.resolve(conflict, "merge", { ...local, ...extra })).rejects.toThrow();
      expect(store.getSnapshot()).toBe(before);
    }
    await store.close();
  });
});
