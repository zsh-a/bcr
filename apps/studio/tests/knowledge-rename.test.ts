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
  it("preserves source formatting, aliases and headings; ignores code and embeds", () => {
    const before = { target, source };
    const next = preserveRenamedLinks(
      before,
      { ...before, target: { ...target, title: "新标题" } },
      "target",
    );
    expect(next.source!.body).toBe(
      source.body
        .replace("[[旧标题]] [[旧标题#章节|别名]]", "[[target|旧标题]] [[target#章节|别名]]")
        .replace("[原链接](旧标题.md)", "[原链接](target.md)"),
    );
    expect(next.target!.body).toBe("[[target|旧标题]]");
    expect(before.source.body).toBe(source.body);
  });
  it.each([
    ['[**加粗** 与 `代码`](旧标题.md "提示")', '[**加粗** 与 `代码`](target.md "提示")'],
    ["[说明](<旧标题.md#章节> '提示')", "[说明](<target.md#%E7%AB%A0%E8%8A%82> '提示')"],
    ["[](旧标题.md)", "[](target.md)"],
    ['[说明](\n  %E6%97%A7%E6%A0%87%E9%A2%98.md\n  "提示"\n)', '[说明](\n  target.md\n  "提示"\n)'],
    ["[![图片](image.png)](旧标题.md)", "[![图片](image.png)](target.md)"],
    ["[引用][ref]\n\n[ref]: 旧标题.md", "[引用](target.md)\n\n[ref]: 旧标题.md"],
    [
      "![图片](旧标题.md) [外链](https://example.com/旧标题.md)",
      "![图片](旧标题.md) [外链](https://example.com/旧标题.md)",
    ],
    ["`[代码](旧标题.md)` \\[转义](旧标题.md)", "`[代码](旧标题.md)` \\[转义](旧标题.md)"],
  ])("rewrites only an inline destination: %s", (body, expected) => {
    const before = { target, source: { ...source, body } };
    const next = preserveRenamedLinks(
      before,
      { ...before, target: { ...target, title: "新标题" } },
      "target",
    );
    expect(next.source!.body).toBe(expected);
  });
  it("handles balanced and escaped parentheses in destinations without replacing tooltip text", () => {
    const old = { ...target, title: "旧(标题)" };
    const before = {
      target: old,
      source: { ...source, body: '[说明](旧(标题).md "旧(标题).md") [另一个](旧\\(标题\\).md)' },
    };
    expect(
      preserveRenamedLinks(before, { ...before, target: { ...old, title: "新标题" } }, "target")
        .source!.body,
    ).toBe('[说明](target.md "旧(标题).md") [另一个](target.md)');
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
