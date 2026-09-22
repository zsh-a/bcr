import { describe, expect, it } from "vitest";
import { NoteDraft, type DraftStorage } from "../src/knowledge/draft";
import { KnowledgeStore } from "../src/knowledge/store";
import { newNote } from "../src/knowledge/model";
import { createNoteAgent } from "../src/knowledge/editorAgent";

async function setup() {
  const data = new Map<string, string>(),
    drafts = new Map<string, string>();
  let write = async () => {};
  const store = new KnowledgeStore({
    get: async (key) => data.get(key),
    set: async (key, value) => {
      await write();
      data.set(key, value);
    },
  });
  const note = { ...newNote("Test"), body: "original" };
  await store.saveNote(note, null);
  const storage: DraftStorage = {
    getItem: (key) => drafts.get(key) ?? null,
    setItem: (key, value) => {
      drafts.set(key, value);
    },
    removeItem: (key) => {
      drafts.delete(key);
    },
  };
  return {
    store,
    note,
    storage,
    drafts,
    controller: new NoteDraft(note, store, storage),
    onWrite: (next: () => Promise<void>) => {
      write = next;
    },
  };
}

describe("note draft controller", () => {
  it("waits for durable writes and drains edits made during a save", async () => {
    const s = await setup(),
      gate = Promise.withResolvers<void>(),
      started = Promise.withResolvers<void>();
    s.onWrite(async () => {
      started.resolve();
      await gate.promise;
    });
    s.controller.change({ body: "first" });
    const saving = s.controller.flush();
    await started.promise;
    expect(s.controller.getSnapshot().dirty).toBe(true);
    s.controller.change({ body: "second" });
    expect(s.controller.flush()).toBe(saving);
    gate.resolve();
    await Promise.all([saving, s.controller.flush()]);
    expect(s.store.getSnapshot().notes[s.note.id]?.body).toBe("second");
    expect(s.controller.getSnapshot().dirty).toBe(false);
    expect(s.drafts.size).toBe(0);
  });

  it("retains failed drafts, restores them and retries without losing the base", async () => {
    const s = await setup();
    s.controller.change({ body: "unsaved" });
    s.onWrite(async () => {
      throw new Error("disk full");
    });
    await expect(s.controller.flush()).rejects.toThrow("disk full");
    expect(s.controller.getSnapshot()).toMatchObject({
      dirty: true,
      status: "保存失败 · 草稿保留",
    });
    const restored = new NoteDraft(s.note, s.store, s.storage);
    expect(restored.getSnapshot().note.body).toBe("unsaved");
    s.onWrite(async () => {});
    await restored.flush();
    expect(s.store.getSnapshot().notes[s.note.id]?.body).toBe("unsaved");
  });

  it("does not replace a dirty draft when a remote snapshot arrives", async () => {
    const s = await setup();
    s.controller.change({ body: "local" });
    s.controller.receive({ ...s.note, body: "remote" });
    expect(s.controller.getSnapshot().note.body).toBe("local");
    s.controller.setLocked(true);
    await expect(s.controller.flush()).rejects.toThrow("冲突");
    expect(() => s.controller.change({ body: "blocked" })).toThrow("冲突");
  });

  it("keeps tool identities stable while reading live draft, selection and activity", async () => {
    const s = await setup();
    let current = { active: true, selection: { from: 0, to: 4 } };
    const adapter = createNoteAgent(s.controller, () => current);
    const tool = adapter.capability.tools[1]!;
    expect(JSON.parse(await tool.call("{}")).selection).toBe("orig");
    current = { active: true, selection: { from: 4, to: 8 } };
    expect(JSON.parse(await tool.call("{}")).selection).toBe("inal");
    s.controller.change({ title: "New title" });
    expect(adapter.surface.label).toBe("New title");
    await adapter.surface.write("saved by agent");
    expect(s.store.getSnapshot().notes[s.note.id]?.body).toBe("saved by agent");
    current = { ...current, active: false };
    expect(adapter.surface.read()).toBeNull();
    expect(adapter.capability.available?.()).toBe(false);
  });

  it("blocks editing rather than overwriting an unreadable recovery copy", async () => {
    const s = await setup();
    s.storage.setItem(`bcr/knowledge-draft/v1/${s.note.id}`, "broken");
    const draft = new NoteDraft(s.note, s.store, s.storage);
    expect(draft.editable).toBe(false);
    expect(() => draft.change({ body: "replacement" })).toThrow("无法读取");
    expect(s.drafts.values().next().value).toBe("broken");
  });
});
