import { describe, expect, it } from "vitest";
import { KnowledgeStore } from "../src/knowledge/store";
import { newNote } from "../src/knowledge/model";
import { NoteDraft } from "../src/knowledge/draft";

async function fixture() {
  let writes = 0;
  const store = new KnowledgeStore({
    get: async () => undefined,
    set: async () => {
      writes++;
    },
  });
  const target = { ...newNote("Alpha"), id: "alpha", body: "original" };
  const source = { ...newNote("Beta"), id: "beta", body: "[[Alpha]]" };
  await store.importContent({ notes: { alpha: target, beta: source }, collections: {} });
  const backups = new Map<string, string>();
  const storage = {
    getItem: (key: string) => backups.get(key) ?? null,
    setItem: (key: string, value: string) => {
      backups.set(key, value);
    },
    removeItem: (key: string) => {
      backups.delete(key);
    },
  };
  return { store, target, source, writes: () => writes, storage, backups };
}

describe("reviewed note changes", () => {
  it("upgrades old title recovery drafts into an unapproved proposal without losing body edits", async () => {
    const f = await fixture();
    f.storage.setItem(
      "bcr/knowledge-draft/v1/alpha",
      JSON.stringify({
        base: f.target,
        note: { ...f.target, title: "Legacy rename", body: "legacy body" },
      }),
    );
    const draft = new NoteDraft(f.target, f.store, f.storage);
    expect(draft.getSnapshot()).toMatchObject({
      proposedTitle: "Legacy rename",
      note: { title: "Alpha", body: "legacy body" },
    });
    await draft.flush();
    expect(f.store.getSnapshot().notes.alpha).toMatchObject({
      title: "Alpha",
      body: "legacy body",
    });
    expect(f.store.getSnapshot().notes.beta!.body).toBe("[[Alpha]]");
  });
  it("does not write while planning and requires explicit approval for cross-note saves", async () => {
    const f = await fixture(),
      before = f.store.getSnapshot(),
      writes = f.writes();
    const plan = await f.store.previewRename("alpha", "Renamed");
    expect(plan.changes.map((c) => c.before.id)).toEqual(["alpha", "beta"]);
    expect(f.store.getSnapshot()).toBe(before);
    expect(f.writes()).toBe(writes);
    await expect(f.store.saveNote({ ...f.target, title: "Renamed" }, f.target)).rejects.toThrow(
      "预览并确认",
    );
    expect(f.store.getSnapshot()).toBe(before);
    await f.store.applyChangePlan(plan);
    expect(f.writes()).toBe(writes + 1);
    expect(f.store.getSnapshot().notes.beta!.body).toBe("[[alpha|Alpha]]");
    await expect(f.store.applyChangePlan(plan)).rejects.toThrow("无效或已执行");
  });
  it.each(["edit", "add", "delete", "ambiguity"])(
    "rejects stale previews after %s without partial writes",
    async (mode) => {
      const f = await fixture(),
        plan = await f.store.previewRename("alpha", "Renamed");
      if (mode === "edit") await f.store.saveNote({ ...f.source, body: "Changed" }, f.source);
      if (mode === "add") await f.store.saveNote({ ...newNote("New"), body: "[[Alpha]]" }, null);
      if (mode === "delete") await f.store.deleteNote("beta");
      if (mode === "ambiguity") await f.store.saveNote(newNote("Alpha"), null);
      const before = f.store.getSnapshot(),
        writes = f.writes();
      await expect(f.store.applyChangePlan(plan)).rejects.toThrow("刷新预览");
      expect(f.store.getSnapshot()).toBe(before);
      expect(f.writes()).toBe(writes);
    },
  );
  it("rejects tampered and foreign plans and validates the caller inside the queue", async () => {
    const f = await fixture(),
      plan = await f.store.previewRename("alpha", "Renamed");
    await expect(f.store.applyChangePlan(structuredClone(plan))).rejects.toThrow("计划无效");
    await expect(
      f.store.applyChangePlan(plan, () => {
        throw new Error("draft changed");
      }),
    ).rejects.toThrow("draft changed");
    plan.changes[0]!.after.body = "tampered";
    await expect(f.store.applyChangePlan(plan)).rejects.toThrow("计划无效");
    expect(f.store.getSnapshot().notes.alpha).toEqual(f.target);
  });
  it("checks target and referencing draft guards at confirmation time", async () => {
    const f = await fixture(),
      plan = await f.store.previewRename("alpha", "Renamed");
    const remove = f.store.registerDraft("alpha", () => true);
    await expect(f.store.applyChangePlan(plan)).rejects.toThrow("未保存草稿");
    remove();
    await f.store.applyChangePlan(plan);
    expect(f.store.getSnapshot().notes.alpha!.title).toBe("Renamed");
  });
  it("continues saving body while keeping the proposed title only in recovery storage", async () => {
    const f = await fixture(),
      draft = new NoteDraft(f.target, f.store, f.storage);
    draft.changeTitle("Renamed");
    draft.change({ body: "new body" });
    await draft.flush();
    expect(f.store.getSnapshot().notes.alpha).toMatchObject({ title: "Alpha", body: "new body" });
    expect(f.store.getSnapshot().notes.beta!.body).toBe("[[Alpha]]");
    await expect(draft.flushForNavigation()).rejects.toThrow("确认或取消");
    const restored = new NoteDraft(f.store.getSnapshot().notes.alpha!, f.store, f.storage);
    expect(restored.getSnapshot()).toMatchObject({ dirty: false, proposedTitle: "Renamed" });
    restored.cancelRename();
    await restored.flushForNavigation();
    expect(restored.getSnapshot().note.body).toBe("new body");
    expect(f.backups.size).toBe(0);
  });
});
