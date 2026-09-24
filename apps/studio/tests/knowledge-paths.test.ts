import { describe, expect, it } from "vitest";
import {
  assertUniquePaths,
  normalizeNotePath,
  notePath,
  relativeNotePath,
} from "../src/knowledge/paths";
import {
  newNote,
  decodeContent,
  decodeState,
  emptyKnowledge,
  type KnowledgeNote,
} from "../src/knowledge/model";
import { folderMoves, planNoteMove } from "../src/knowledge/changePlan";
import { createNoteResolver, KnowledgeLinkIndex } from "../src/knowledge/markdownAnalysis";
import { contentFiles, filesContent, MANIFEST } from "../src/knowledge/files";
import { KnowledgeStore, KNOWLEDGE_KEY, KNOWLEDGE_PATH_BACKUP_KEY } from "../src/knowledge/store";
import { mergeContent } from "../src/knowledge/merge";
import {
  planKnowledgeRestore,
  readKnowledgeBackup,
  writeKnowledgeBackup,
} from "../src/knowledge/backup";

const note = (id: string, path?: string, body = ""): KnowledgeNote => ({
  ...newNote(id),
  id,
  body,
  ...(path === undefined ? {} : { path }),
});
const content = (...notes: KnowledgeNote[]) => ({
  notes: Object.fromEntries(notes.map((n) => [n.id, n])),
  collections: {},
});
function fixture() {
  const data = new Map<string, string>();
  const writes: string[] = [];
  let fail = "";
  const metadata = {
    get: async (key: string) => data.get(key),
    set: async (key: string, value: string) => {
      if (key === fail) throw new Error("disk full");
      writes.push(key);
      data.set(key, value);
    },
  };
  return {
    store: new KnowledgeStore(metadata),
    data,
    metadata,
    writes,
    fail: (key: string) => {
      fail = key;
    },
  };
}

describe("portable logical paths", () => {
  it("keeps case-distinct legacy IDs readable without implicit migration", () => {
    const source = content(note("a"), note("A"));
    expect(decodeContent(source)).toEqual(source);
    expect(
      planNoteMove(source.notes, { a: "folder/lower.md", A: "folder/upper.md" }).changes,
    ).toHaveLength(2);
  });
  it.each([
    "../a.md",
    "/a.md",
    "a//b.md",
    "a/./b.md",
    "a/../b.md",
    "a\\b.md",
    "CON.md",
    "a/NUL.txt.md",
    ".hidden/a.md",
    "a/#b.md",
    "a/%20.md",
    "a/ b.md",
    "a.txt",
    "a/\u0000.md",
    "folder./a.md",
  ])("rejects unsafe path %s", (path) => {
    expect(() => normalizeNotePath(path)).toThrow();
  });
  it("normalizes Unicode and extension without renaming legacy data", () => {
    expect(normalizeNotePath("研究/Cafe\u0301.MD")).toBe("研究/Café.md");
    const legacy = note("legacy");
    expect(notePath(legacy)).toBe("legacy.md");
    expect(decodeContent(content(legacy)).notes.legacy).not.toHaveProperty("path");
    expect(decodeState(JSON.stringify({ ...emptyKnowledge(), ...content(legacy) })).version).toBe(
      1,
    );
  });
  it("rejects case-insensitive collisions, reserved identity aliases and file/folder overlap", () => {
    for (const notes of [
      content(note("a", "Topic.md"), note("b", "topic.md")),
      content(note("a", "folder/a.md"), note("b", "a.md")),
      content(note("a", "File.md"), note("b", "file.md/child.md")),
      content(note("a"), note("b", "a.md")),
    ])
      expect(() => assertUniquePaths(notes.notes)).toThrow("路径冲突");
  });
  it("resolves relative paths, root paths, IDs, headings and legacy titles", () => {
    const notes = [
      note("a", "x/a.md"),
      note("b", "x/Topic.md"),
      note("c", "Topic.md"),
      { ...note("d"), title: "Legacy" },
    ];
    const resolve = createNoteResolver(notes);
    expect(resolve("Topic.md#Part", "a")[0]?.id).toBe("b");
    expect(resolve("../Topic", "a")[0]?.id).toBe("c");
    expect(resolve("x/Topic", "c")[0]?.id).toBe("b");
    expect(resolve("b.md", "a")[0]?.id).toBe("b");
    expect(resolve("Legacy.md")[0]?.id).toBe("d");
    expect(resolve("#part", "a")[0]?.id).toBe("a");
    expect(resolve("../../Topic", "a")).toEqual([]);
    expect(relativeNotePath("../outside", "root.md")).toBeNull();
  });
  it("roundtrips v2 through stable physical filenames and portable ZIP", async () => {
    const source = content(note("a", "项目/产品.md"));
    const files = contentFiles(source);
    expect(JSON.parse(files[MANIFEST]!).version).toBe(2);
    expect(files["knowledge/notes/a.md"]).toContain("path: 项目/产品.md");
    expect(filesContent(files)).toEqual(source);
    expect(await readKnowledgeBackup(await writeKnowledgeBackup(source))).toEqual(source);
    expect(JSON.parse(contentFiles(content(note("a")))[MANIFEST]!).version).toBe(1);
  });
  it("merges an independent body edit and move, but flags competing moves", () => {
    const a = note("a", "before.md"),
      base = content(a);
    const local = content({ ...a, body: "changed" });
    const remote = content({ ...a, path: "after.md" });
    const merged = mergeContent(base, local, remote);
    expect(merged.conflicts).toEqual([]);
    expect(merged.content.notes.a).toMatchObject({ body: "changed", path: "after.md" });
    expect(mergeContent(base, content({ ...a, path: "local.md" }), remote).conflicts).toHaveLength(
      1,
    );
  });
  it("gives restore copies distinct paths", () => {
    const a = note("a", "项目/产品.md");
    const restored = planKnowledgeRestore(content(a), content({ ...a, body: "backup" }), "both");
    expect(Object.values(restored.content.notes).map(notePath)).toContain("项目/产品 (2).md");
  });
});

describe("reviewed moves", () => {
  it("preserves incoming/outgoing links and headings; leaves images and unresolved links alone", () => {
    const a = note(
      "a",
      "old/Alpha.md",
      "[out](Beta.md#part)\n\n![image](photo.png)\n\n[[missing]]",
    );
    const b = note("b", "old/Beta.md", '[[Alpha#part|See]]\n\n[ref][r]\n\n[r]: Alpha.md "title"');
    const source = content(a, b);
    const plan = planNoteMove(source.notes, { a: "new/Alpha.md" });
    expect(plan.changes).toHaveLength(2);
    expect(plan.changes.find((c) => c.after.id === "a")?.after.body).toBe(
      "[out](b.md#part)\n\n![image](photo.png)\n\n[[missing]]",
    );
    const changed = plan.changes.find((c) => c.after.id === "b")!.after;
    expect(changed.body).toContain("[[a#part|See]]");
    expect(changed.body).toContain('[ref](a.md "title")');
    expect(changed.body).toContain('[r]: Alpha.md "title"');
    expect(a.path).toBe("old/Alpha.md");
    const next = content(...plan.changes.map((c) => c.after));
    expect(planNoteMove(next.notes, { a: "new/Alpha.md" }).changes).toHaveLength(0);
    const index = new KnowledgeLinkIndex();
    index.update(Object.values(next.notes));
    expect(index.backlinks(Object.values(next.notes), "a").map((n) => n.id)).toEqual(["b"]);
  });
  it("moves entire folders including descendants, preserves internal relative links", () => {
    const source = content(note("a", "old/Alpha.md", "[[sub/Beta]]"), note("b", "old/sub/Beta.md"));
    const moves = folderMoves(source.notes, "old", "archive/new");
    expect(moves).toEqual({ a: "archive/new/Alpha.md", b: "archive/new/sub/Beta.md" });
    expect(planNoteMove(source.notes, moves).changes[0]?.after.body).toBe("[[sub/Beta]]");
    expect(() => folderMoves(source.notes, "old", "old/sub")).toThrow("子目录");
    expect(folderMoves(source.notes, "old", "").a).toBe("Alpha.md");
  });
  it("preserves targets shadowed by a newly moved file", () => {
    const source = content(
      note("a", "Topic.md"),
      note("b", "else/Topic.md"),
      note("c", "here/Ref.md", "[[Topic]]"),
    );
    const plan = planNoteMove(source.notes, { b: "here/Topic.md" });
    expect(plan.changes.find((c) => c.after.id === "c")?.after.body).toBe("[[a|Topic]]");
  });
  it("does not guess ambiguous titles", () => {
    const a = { ...note("a"), title: "Same" },
      b = { ...note("b"), title: "Same" };
    const plan = planNoteMove(content(a, b, note("c", undefined, "[[Same]]")).notes, {
      a: "new/Same.md",
    });
    expect(plan.changes.map((c) => c.after.id)).toEqual(["a"]);
  });
  it("backs up once before the first path write; preview is read-only, IDs persist after reload", async () => {
    const f = fixture();
    await f.store.saveNote(note("a"), null);
    const before = f.data.get(KNOWLEDGE_KEY),
      writes = f.writes.length;
    const plan = await f.store.previewMove({ a: "项目/产品.md" });
    expect(f.writes).toHaveLength(writes);
    await f.store.applyChangePlan(plan);
    expect(f.writes.slice(writes)).toEqual([KNOWLEDGE_PATH_BACKUP_KEY, KNOWLEDGE_KEY]);
    expect(f.data.get(KNOWLEDGE_PATH_BACKUP_KEY)).toBe(before);
    const reloaded = new KnowledgeStore(f.metadata);
    await reloaded.ready;
    expect(reloaded.getSnapshot()).toMatchObject({
      version: 2,
      notes: { a: { path: "项目/产品.md" } },
    });
    await reloaded.applyChangePlan(await reloaded.previewMove({ a: "archive/产品.md" }));
    expect(f.data.get(KNOWLEDGE_PATH_BACKUP_KEY)).toBe(before);
    expect(f.store.getSnapshot().history.at(-1)?.note.id).toBe("a");
  });
  it.each([KNOWLEDGE_PATH_BACKUP_KEY, KNOWLEDGE_KEY])(
    "does not publish a failed write at %s",
    async (key) => {
      const f = fixture();
      await f.store.saveNote(note("a"), null);
      const before = f.store.getSnapshot(),
        raw = f.data.get(KNOWLEDGE_KEY);
      const plan = await f.store.previewMove({ a: "new/a.md" });
      f.fail(key);
      await expect(f.store.applyChangePlan(plan)).rejects.toThrow("disk full");
      expect(f.store.getSnapshot()).toBe(before);
      expect(f.data.get(KNOWLEDGE_KEY)).toBe(raw);
      f.fail("");
      await f.store.applyChangePlan(plan);
      expect(f.store.getSnapshot().notes.a?.path).toBe("new/a.md");
    },
  );
  it("rejects collisions, unreviewed moves, stale plans, and dirty drafts without partial writes", async () => {
    const f = fixture(),
      a = note("a"),
      b = note("b");
    await f.store.importContent(content(a, b));
    await expect(f.store.previewMove({ a: "b.md" })).rejects.toThrow("路径冲突");
    await expect(f.store.saveNote({ ...a, path: "new.md" }, a)).rejects.toThrow("预览并确认");
    const plan = await f.store.previewMove({ a: "new.md" });
    const remove = f.store.registerDraft("a", () => true);
    await expect(f.store.applyChangePlan(plan)).rejects.toThrow("未保存草稿");
    remove();
    await f.store.saveNote({ ...b, body: "changed" }, b);
    const raw = f.data.get(KNOWLEDGE_KEY);
    await expect(f.store.applyChangePlan(plan)).rejects.toThrow("刷新预览");
    expect(f.data.get(KNOWLEDGE_KEY)).toBe(raw);
  });
  it("upgrades when a path exists only in sync snapshots", async () => {
    const f = fixture();
    await f.store.ready;
    await f.store.update((s) => ({
      ...s,
      sync: { ...s.sync, base: content(note("a", "remote/a.md")) },
    }));
    expect(f.store.getSnapshot().version).toBe(2);
    expect(f.data.has(KNOWLEDGE_PATH_BACKUP_KEY)).toBe(true);
  });
});
