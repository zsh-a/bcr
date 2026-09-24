import { describe, expect, it } from "vitest";
import { newNote, type KnowledgeNote } from "../src/knowledge/model";
import { KnowledgeStore } from "../src/knowledge/store";
import { preserveRenamedLinks } from "../src/knowledge/renameLinks";
import { noteRevision } from "../src/knowledge/noteRevision";

const target = { ...newNote("旧标题"), id: "target", body: "[[旧标题]]" };
const source = {
  ...newNote("引用"),
  id: "source",
  body: "[[旧标题]] [[旧标题#章节|别名]] [[target|稳定]] [[#本页]]\n\n`[[旧标题]]`\n\n```md\n[[旧标题]]\n```\n\n\\[[旧标题]] ![[旧标题]] [原链接](旧标题.md)",
};
async function fixture(extra: KnowledgeNote[] = []) {
  let raw: string | undefined;
  let fail = false,
    writes = 0;
  const metadata = {
    get: async () => raw,
    set: async (_: string, next: string) => {
      if (fail) throw new Error("disk full");
      raw = next;
      writes++;
    },
  };
  const store = new KnowledgeStore(metadata);
  await store.importContent({
    notes: Object.fromEntries([target, source, ...extra].map((n) => [n.id, n])),
    collections: {},
  });
  return {
    store,
    metadata,
    writes: () => writes,
    fail: () => {
      fail = true;
    },
  };
}

describe("editor rename reference transaction", () => {
  it("preserves the visible title when the original alias is empty", () => {
    const before = { target, source: { ...source, body: "[[旧标题|]]" } };
    const next = preserveRenamedLinks(
      before,
      { ...before, target: { ...target, title: "新标题" } },
      "target",
    );
    expect(next.source!.body).toBe("[[target|旧标题]]");
  });
  it("preserves source formatting, aliases and headings; ignores code, embeds and non-wiki links", () => {
    const before = { target, source };
    const next = preserveRenamedLinks(
      before,
      { ...before, target: { ...target, title: "新标题" } },
      "target",
    );
    expect(next.source!.body).toBe(
      source.body.replace(
        "[[旧标题]] [[旧标题#章节|别名]]",
        "[[target|旧标题]] [[target#章节|别名]]",
      ),
    );
    expect(next.target!.body).toBe("[[target|旧标题]]");
    expect(before.source.body).toBe(source.body);
  });
  it("does not guess ambiguous titles or change already stable links", () => {
    const before = { target, source, duplicate: { ...target, id: "duplicate" } };
    const next = preserveRenamedLinks(
      before,
      { ...before, target: { ...target, title: "新标题" } },
      "target",
    );
    expect(next.source).toBe(source);
    expect(next.duplicate).toBe(before.duplicate);
  });
  it("persists rename, backlinks and history in one write and survives reopening", async () => {
    const f = await fixture();
    const writes = f.writes();
    await f.store.saveNote({ ...target, title: "新标题" }, target);
    expect(f.writes()).toBe(writes + 1);
    expect(f.store.getSnapshot().notes.source!.body).toContain("[[target#章节|别名]]");
    expect(
      f.store
        .getSnapshot()
        .history.map((r) => r.note.id)
        .sort(),
    ).toEqual(["source", "target"]);
    const reopened = new KnowledgeStore(f.metadata);
    await reopened.ready;
    expect(reopened.getSnapshot()).toEqual(f.store.getSnapshot());
  });
  it("rejects the entire transaction when a referencing note has a dirty draft", async () => {
    const f = await fixture();
    const original = f.store.getSnapshot();
    const unregister = f.store.registerDraft("source", () => true);
    await expect(f.store.saveNote({ ...target, title: "新标题" }, target)).rejects.toThrow(
      "未保存草稿",
    );
    expect(f.store.getSnapshot()).toBe(original);
    unregister();
    await f.store.saveNote({ ...target, title: "新标题" }, target);
    expect(f.store.getSnapshot().notes.target!.title).toBe("新标题");
  });
  it("rejects conflicted references without partial writes", async () => {
    const f = await fixture();
    await f.store.update((s) => ({
      ...s,
      conflicts: [
        {
          kind: "note",
          key: "source",
          base: source,
          local: source,
          remote: { ...source, body: "remote" },
        },
      ],
    }));
    const original = f.store.getSnapshot();
    await expect(f.store.saveNote({ ...target, title: "新标题" }, target)).rejects.toThrow(
      "同步冲突",
    );
    expect(f.store.getSnapshot()).toBe(original);
  });
  it("does not publish partial in-memory updates on persistence failure", async () => {
    const f = await fixture();
    const original = f.store.getSnapshot();
    f.fail();
    await expect(f.store.saveNote({ ...target, title: "新标题" }, target)).rejects.toThrow(
      "disk full",
    );
    expect(f.store.getSnapshot()).toBe(original);
  });
  it("keeps an Agent single-note approval scoped to that note", async () => {
    const f = await fixture();
    await f.store.saveAgentNote({ ...target, title: "Agent 标题" }, noteRevision(target), () => {});
    expect(f.store.getSnapshot().notes.source).toEqual(source);
  });
});
