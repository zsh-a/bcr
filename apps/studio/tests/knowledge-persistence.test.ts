import { describe, expect, it } from "vitest";
import initSqlite from "@sqlite.org/sqlite-wasm";
import { openSqliteDb } from "@bcr/storage-sqlite";
import { MemoryStore } from "@bcr/storage-opfs";
import { KnowledgeStore } from "../src/knowledge/store";
import {
  KnowledgePersistence,
  KNOWLEDGE_KEY,
  KNOWLEDGE_RECORD_BACKUP_KEY,
} from "../src/knowledge/persistence";
import { contentOf, decodeState, emptyKnowledge, newNote } from "../src/knowledge/model";

function fixture() {
  const data = new Map<string, string>();
  const batches: (readonly (readonly [string, string | undefined])[])[] = [];
  let fail = false,
    uncertain = false;
  const metadata = {
    get: async (key: string) => data.get(key),
    set: async (key: string, raw: string) => {
      data.set(key, raw);
    },
    batch: async (entries: readonly (readonly [string, string | undefined])[]) => {
      batches.push(entries);
      if (fail) throw new Error("disk full");
      for (const [key, raw] of entries)
        if (raw === undefined) data.delete(key);
        else data.set(key, raw);
      if (uncertain) throw new Error("receipt lost");
    },
  };
  return {
    data,
    metadata,
    batches,
    fail: (value: boolean) => {
      fail = value;
    },
    uncertain: (value: boolean) => {
      uncertain = value;
    },
  };
}
const note = (id: string, body = "original") => ({ ...newNote(id), id, body });
const key = (section: string, id: string) => `workspace/knowledge.records/${section}/${id}`;

describe("knowledge record persistence", () => {
  it("migrates and reopens through the real SQLite adapter", async () => {
    const binary = new MemoryStore(),
      sqlite3 = await initSqlite();
    const db = await openSqliteDb({ store: binary, path: "knowledge.db", sqlite3 });
    const a = note("a"),
      legacy = JSON.stringify({ ...emptyKnowledge(), notes: { a } });
    await db.kvSet(KNOWLEDGE_KEY, legacy);
    const store = new KnowledgeStore({ get: db.kvGet, set: db.kvSet, batch: db.kvBatch! });
    await store.ready;
    await store.saveNote({ ...a, body: "durable" }, a);
    const expected = store.getSnapshot();
    await store.close();
    await db.close();
    const reopened = await openSqliteDb({ store: binary, path: "knowledge.db", sqlite3 });
    const hydrated = new KnowledgeStore({
      get: reopened.kvGet,
      set: reopened.kvSet,
      batch: reopened.kvBatch!,
    });
    await hydrated.ready;
    expect(hydrated.getSnapshot()).toEqual(expected);
    expect(await reopened.kvGet(KNOWLEDGE_RECORD_BACKUP_KEY)).toBe(legacy);
    await hydrated.close();
    await reopened.close();
  });
  it("rejects a mixed read when the manifest changes while records are loading", async () => {
    const f = fixture(),
      store = new KnowledgeStore(f.metadata);
    await store.saveNote(note("a"), null);
    let changed = false;
    const metadata = {
      ...f.metadata,
      get: async (id: string) => {
        if (!changed && id.includes("/notes/")) {
          changed = true;
          const root = JSON.parse(f.data.get(KNOWLEDGE_KEY)!);
          f.data.set(KNOWLEDGE_KEY, JSON.stringify({ ...root, commit: "new-commit" }));
        }
        return f.data.get(id);
      },
    };
    await expect(new KnowledgeStore(metadata).ready).rejects.toThrow("读取期间");
  });
  it("reads legacy state without migration and backs it up atomically on the first write", async () => {
    const f = fixture(),
      a = note("a");
    const original = JSON.stringify({ ...emptyKnowledge(), notes: { a } });
    f.data.set(KNOWLEDGE_KEY, original);
    const store = new KnowledgeStore(f.metadata);
    await store.ready;
    expect(f.batches).toHaveLength(0);
    expect(f.data.get(KNOWLEDGE_KEY)).toBe(original);
    await store.saveNote({ ...a, body: "changed" }, a);
    expect(f.batches).toHaveLength(1);
    expect(f.data.get(KNOWLEDGE_RECORD_BACKUP_KEY)).toBe(original);
    expect(JSON.parse(f.data.get(KNOWLEDGE_KEY)!).version).toBe(3);
    expect(() => decodeState(f.data.get(KNOWLEDGE_KEY))).toThrow();
    const reopened = new KnowledgeStore(f.metadata);
    await reopened.ready;
    expect(reopened.getSnapshot()).toEqual(store.getSnapshot());
    await reopened.saveNote(
      { ...reopened.getSnapshot().notes.a!, body: "again" },
      reopened.getSnapshot().notes.a!,
    );
    expect(f.data.get(KNOWLEDGE_RECORD_BACKUP_KEY)).toBe(original);
  });
  it("updates only the changed note, new history and manifest, without rewriting other notes", async () => {
    const f = fixture(),
      store = new KnowledgeStore(f.metadata),
      a = note("a"),
      b = note("b", "b".repeat(10000));
    await store.importContent({ notes: { a, b }, collections: {} });
    await store.saveNote({ ...a, body: "updated" }, a);
    const written = f.batches.at(-1)!.map(([key]) => key);
    expect(written).toHaveLength(3);
    expect(written).toContain(key("notes", "a"));
    expect(written).not.toContain(key("notes", "b"));
    expect(written.some((key) => key.includes("/history/"))).toBe(true);
    expect(f.data.get(KNOWLEDGE_KEY)).not.toContain("updated");
    expect(f.batches.at(-1)!.reduce((size, [, raw]) => size + (raw?.length ?? 0), 0)).toBeLessThan(
      2500,
    );
  });
  it("roundtrips paths, collections, history, conflict snapshots, base and pending content", async () => {
    const f = fixture(),
      a = { ...note("a"), path: "项目/笔记.md", collectionId: "group" };
    const base = { notes: { a }, collections: { group: { id: "group", name: "Group" } } };
    const state = {
      ...emptyKnowledge(),
      ...base,
      version: 2 as const,
      history: [{ id: "rev", note: a, at: 10, reason: "test" }],
      conflicts: [
        {
          key: "a",
          kind: "note" as const,
          base: a,
          local: { ...a, body: "local" },
          remote: { ...a, body: "remote" },
        },
      ],
      sync: { ...emptyKnowledge().sync, base, pending: { head: "a".repeat(40), content: base } },
    };
    const persistence = new KnowledgePersistence(f.metadata);
    await persistence.load();
    await persistence.save(state);
    expect(await new KnowledgePersistence(f.metadata).load()).toEqual(state);
  });
  it("deletes obsolete records in the same batch without touching other namespaces", async () => {
    const f = fixture(),
      store = new KnowledgeStore(f.metadata);
    f.data.set("workspace/research.v1", "unrelated");
    await store.saveNote(note("a"), null);
    await store.deleteNote("a");
    expect(f.data.has(key("notes", "a"))).toBe(false);
    expect(f.batches.at(-1)).toContainEqual([key("notes", "a"), undefined]);
    expect(f.data.get("workspace/research.v1")).toBe("unrelated");
    const oldHistory = [...f.data.keys()].filter((key) => key.includes("/history/"));
    await store.update((state) => ({ ...state, history: [] }));
    expect(oldHistory.every((key) => !f.data.has(key))).toBe(true);
    expect((await new KnowledgePersistence(f.metadata).load()).notes).toEqual({});
  });
  it("does not partially migrate when batch persistence fails", async () => {
    const f = fixture(),
      a = note("a"),
      raw = JSON.stringify({ ...emptyKnowledge(), notes: { a } });
    f.data.set(KNOWLEDGE_KEY, raw);
    const store = new KnowledgeStore(f.metadata);
    await store.ready;
    const before = store.getSnapshot();
    f.fail(true);
    await expect(store.saveNote({ ...a, body: "changed" }, a)).rejects.toThrow("disk full");
    expect(store.getSnapshot()).toBe(before);
    expect([...f.data.entries()]).toEqual([[KNOWLEDGE_KEY, raw]]);
    f.fail(false);
    await store.saveNote({ ...a, body: "changed" }, a);
    expect((await new KnowledgePersistence(f.metadata).load()).notes.a?.body).toBe("changed");
  });
  it("reloads an uncertain successful batch before retrying, without duplicating history", async () => {
    const f = fixture(),
      store = new KnowledgeStore(f.metadata),
      a = note("a");
    await store.saveNote(a, null);
    const before = store.getSnapshot();
    f.uncertain(true);
    const changed = { ...a, body: "changed" };
    await expect(store.saveNote(changed, a)).rejects.toThrow("receipt lost");
    expect(store.getSnapshot()).toBe(before);
    f.uncertain(false);
    await store.saveNote(changed, a);
    expect(store.getSnapshot().notes.a?.body).toBe("changed");
    expect(store.getSnapshot().history).toHaveLength(1);
  });
  it("refuses stale writers and then merges through the Store retry barrier", async () => {
    const f = fixture(),
      first = new KnowledgeStore(f.metadata),
      a = note("a"),
      b = note("b");
    await first.importContent({ notes: { a, b }, collections: {} });
    const second = new KnowledgeStore(f.metadata);
    await second.ready;
    await first.saveNote({ ...a, body: "one" }, a);
    await expect(second.saveNote({ ...b, body: "two" }, b)).rejects.toThrow("持久化状态已变化");
    await second.saveNote({ ...b, body: "two" }, b);
    expect(second.getSnapshot().notes.a?.body).toBe("one");
    expect(second.getSnapshot().notes.b?.body).toBe("two");
  });
  it.each(["missing", "invalid", "identity"])(
    "fails closed for %s records without repairing or deleting user data",
    async (mode) => {
      const f = fixture(),
        store = new KnowledgeStore(f.metadata);
      await store.saveNote(note("a"), null);
      if (mode === "missing") f.data.delete(key("notes", "a"));
      if (mode === "invalid") f.data.set(key("notes", "a"), "{");
      if (mode === "identity") f.data.set(key("notes", "a"), JSON.stringify(note("other")));
      const snapshot = [...f.data.entries()],
        count = f.batches.length;
      await expect(new KnowledgeStore(f.metadata).ready).rejects.toThrow();
      expect(f.batches).toHaveLength(count);
      expect([...f.data.entries()]).toEqual(snapshot);
    },
  );
  it("rejects invalid references and adapters unable to atomically write migrated data", async () => {
    const f = fixture(),
      store = new KnowledgeStore(f.metadata);
    await store.saveNote(note("a"), null);
    await expect(
      new KnowledgeStore({ get: f.metadata.get, set: f.metadata.set }).ready,
    ).rejects.toThrow("原子批量写入");
    const root = JSON.parse(f.data.get(KNOWLEDGE_KEY)!);
    root.state.notes = ["../secret"];
    f.data.set(KNOWLEDGE_KEY, JSON.stringify(root));
    await expect(new KnowledgeStore(f.metadata).ready).rejects.toThrow("清单无效");
  });
  it("preserves legacy adapters and keeps Git/ZIP content independent of the local layout", async () => {
    const f = fixture(),
      legacy = new KnowledgeStore({ get: f.metadata.get, set: f.metadata.set });
    await legacy.saveNote(note("a"), null);
    expect(JSON.parse(f.data.get(KNOWLEDGE_KEY)!).version).toBe(1);
    const upgraded = new KnowledgeStore(f.metadata);
    await upgraded.ready;
    const before = contentOf(upgraded.getSnapshot());
    await upgraded.configure({ owner: "user", repo: "notes", branch: "main" });
    expect(contentOf(upgraded.getSnapshot())).toEqual(before);
  });
});
