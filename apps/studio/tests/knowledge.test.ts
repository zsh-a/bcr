import { describe, expect, it } from "vitest";
import { createSearchIndex } from "@bcr/core";
import { createKnowledgeGitHub } from "../../../scripts/fixtures/knowledge-github.mjs";
import {
  contentOf,
  decodeState,
  decodeTarget,
  emptyContent,
  newNote,
  pendingCount,
  type KnowledgeNote,
} from "../src/knowledge/model";
import {
  contentFiles,
  filesContent,
  importMarkdown,
  MANIFEST,
  noteMarkdown,
  parseNoteMarkdown,
} from "../src/knowledge/files";
import { mergeContent, mergeText } from "../src/knowledge/merge";
import { KnowledgeStore, publishKnowledge } from "../src/knowledge/store";
import { GitHubKnowledge } from "../src/knowledge/github";
import { syncKnowledge } from "../src/knowledge/sync";

const target = { owner: "alice", repo: "notes", branch: "main" };
const note = (body = "first\nmiddle\nlast\n"): KnowledgeNote => ({
  ...newNote("个人知识"),
  id: "note-one",
  body,
  createdAt: 1,
  updatedAt: 1,
});
const content = (n: KnowledgeNote) => ({ notes: { [n.id]: n }, collections: {} });
function device() {
  let raw: string | undefined;
  let fail = false;
  const metadata = {
    get: async () => raw,
    set: async (_: string, value: string) => {
      if (fail) throw new Error("disk full");
      raw = value;
    },
  };
  return {
    store: new KnowledgeStore(metadata),
    metadata,
    raw: () => raw,
    fail: (value: boolean) => {
      fail = value;
    },
  };
}
function remote() {
  const fixture = createKnowledgeGitHub();
  return {
    fixture,
    api: new GitHubKnowledge(target, "secret-test-token", fixture.fetch as typeof fetch),
  };
}
async function pair() {
  const a = device(),
    b = device(),
    r = remote();
  await a.store.configure(target);
  await b.store.configure(target);
  await a.store.saveNote(note(), null);
  await syncKnowledge(a.store, r.api);
  await syncKnowledge(b.store, r.api);
  return { a, b, ...r };
}
async function edit(store: KnowledgeStore, body: string) {
  const base = store.getSnapshot().notes["note-one"]!;
  await store.saveNote({ ...base, body, updatedAt: base.updatedAt + 1 }, base);
}

describe("portable knowledge format", () => {
  it("roundtrips Unicode Markdown, YAML-sensitive titles, collections and citations", () => {
    const n = {
      ...note("# 手写\n\n---\n```ts\nconst a = 1;\n```\n"),
      title: '标题: "yes"\n第二行',
      tags: ["手写", "true"],
      collectionId: "collection-one",
      citations: [
        {
          id: "citation-one",
          documentId: "reader:one",
          title: "书",
          source: "reader",
          route: "/reader?book=one",
          text: "来源快照",
          note: "注释",
          savedAt: 1,
        },
      ],
    };
    const value = {
      ...content(n),
      collections: { "collection-one": { id: "collection-one", name: "灵感" } },
    };
    expect(filesContent(contentFiles(value))).toEqual(value);
    const imported = importMarkdown(noteMarkdown(n), "export.md");
    expect(imported.body).toBe(n.body);
    expect(imported.id).not.toBe(n.id);
    expect(importMarkdown("# 普通 Markdown\n内容", "普通.md").title).toBe("普通");
  });
  it("refuses unknown manifests, missing declarations and mismatched IDs", () => {
    expect(filesContent({})).toEqual(emptyContent());
    expect(() => filesContent({ "knowledge/notes/a.md": "foreign" })).toThrow("格式声明");
    expect(() => filesContent({ [MANIFEST]: '{"version":2}' })).toThrow();
    expect(() => parseNoteMarkdown(noteMarkdown(note()), "other-id")).toThrow();
    expect(() =>
      filesContent({
        ...contentFiles(content(note())),
        "knowledge/notes/constructor.md": noteMarkdown(note()),
      }),
    ).toThrow();
  });
  it("rejects YAML aliases and executable citations", () => {
    expect(() =>
      parseNoteMarkdown(
        noteMarkdown(note()).replace("title: 个人知识", "title: &a 个人知识\nextra: *a"),
        "note-one",
      ),
    ).toThrow();
    const files = contentFiles(content(note()));
    files["knowledge/citations/note-one.json"] = JSON.stringify([
      {
        id: "evil",
        documentId: "evil",
        title: "x",
        source: "reader",
        route: "javascript:alert(1)",
        text: "x",
        note: "",
        savedAt: 1,
      },
    ]);
    expect(() => filesContent(files)).toThrow();
  });
  it("validates repository targets and keeps token out of persisted state", async () => {
    for (const branch of ["../main", "main.lock", "a//b", "a/.b", "main.", "main?token=x"])
      expect(() => decodeTarget({ ...target, branch })).toThrow();
    expect(decodeTarget({ ...target, branch: "notes/personal" }).branch).toBe("notes/personal");
    const { a } = await pair();
    expect(a.raw()).not.toContain("secret-test-token");
    expect(decodeState(a.raw()).sync.target).toEqual(target);
  });
});

describe("conservative three-way merge", () => {
  it("combines distant line edits and preserves trailing newline", () => {
    expect(mergeText("a\nb\nc\n", "A\nb\nc\n", "a\nb\nC\n")).toBe("A\nb\nC\n");
    expect(mergeText("a\n", "a\nend\n", "a\nend\n")).toBe("a\nend\n");
  });
  it("retains conflicts for same-line edits and competing insertions", () => {
    expect(mergeText("a", "local", "remote")).toBeNull();
    expect(mergeText("a\nb", "a\nx\nb", "a\ny\nb")).toBeNull();
  });
  it("merges independent metadata but does not guess between competing titles", () => {
    const base = note(),
      local = { ...base, title: "新标题" },
      right = { ...base, tags: ["标签"] };
    expect(
      mergeContent(content(base), content(local), content(right)).content.notes[base.id],
    ).toMatchObject({ title: "新标题", tags: ["标签"] });
    expect(
      mergeContent(content(base), content(local), content({ ...base, title: "另一个标题" }))
        .conflicts,
    ).toHaveLength(1);
  });
  it("does not resurrect unchanged deleted notes and retains delete/edit conflicts", () => {
    const base = note();
    expect(mergeContent(content(base), emptyContent(), content(base)).content.notes).toEqual({});
    const result = mergeContent(
      content(base),
      emptyContent(),
      content({ ...base, body: "远端修改" }),
    );
    expect(result.conflicts[0]).toMatchObject({ local: null, remote: { body: "远端修改" } });
  });
});

describe("durable local store", () => {
  it("serializes edits, retains deleted versions and restores after restart", async () => {
    const d = device(),
      n = note();
    await d.store.saveNote(n, null);
    await Promise.all([d.store.saveCollection("one", "One"), d.store.saveCollection("two", "Two")]);
    await d.store.deleteNote(n.id);
    const restored = new KnowledgeStore(d.metadata);
    await restored.ready;
    expect(Object.keys(restored.getSnapshot().collections)).toHaveLength(2);
    expect(restored.getSnapshot().notes[n.id]).toBeUndefined();
    await restored.restore(restored.getSnapshot().history[0]!.note);
    expect(restored.getSnapshot().notes[n.id]!.body).toBe(n.body);
  });
  it("does not publish failed writes and safely retries", async () => {
    const d = device();
    await d.store.ready;
    d.fail(true);
    await expect(d.store.saveNote(note(), null)).rejects.toThrow("disk full");
    expect(d.store.getSnapshot().notes).toEqual({});
    d.fail(false);
    await d.store.saveNote(note(), null);
    expect(decodeState(d.raw()).notes["note-one"]).toBeDefined();
  });
  it("fails closed on corrupt data and after lifecycle disposal", async () => {
    let writes = 0;
    const broken = new KnowledgeStore({
      get: async () => "broken",
      set: async () => {
        writes++;
      },
    });
    await expect(broken.ready).rejects.toThrow();
    await expect(broken.saveNote(note(), null)).rejects.toThrow();
    expect(writes).toBe(0);
    const d = device();
    await d.store.close();
    await expect(d.store.saveNote(note(), null)).rejects.toThrow("关闭");
  });
  it("merges an editor draft against changes arriving during editing", async () => {
    const d = device(),
      base = note();
    await d.store.saveNote(base, null);
    await d.store.saveNote({ ...base, body: "FIRST\nmiddle\nlast\n" }, base);
    await d.store.saveNote({ ...base, body: "first\nmiddle\nLAST\n" }, base);
    expect(d.store.getSnapshot().notes[base.id]!.body).toBe("FIRST\nmiddle\nLAST\n");
  });
  it("indexes notes independently of Reader and removes deleted projections", () => {
    const search = createSearchIndex();
    publishKnowledge(search, content(note("独立手写知识搜索")));
    expect(search.search("独立手写")[0]?.document).toMatchObject({
      kind: "knowledge-note",
      route: "/knowledge?note=note-one",
    });
    publishKnowledge(search, emptyContent());
    expect(search.search("独立手写")).toHaveLength(0);
  });
});

describe("GitHub multi-device synchronization", () => {
  it("refuses a stale connection even if the caller captured an old target", async () => {
    const { a, api, fixture } = await pair();
    await a.store.configure({ ...target, repo: "different-repo" });
    const requests = fixture.state.requests.length;
    await expect(syncKnowledge(a.store, api)).rejects.toThrow("连接已变化");
    expect(fixture.state.requests).toHaveLength(requests);
  });
  it("refuses an oversized file before creating Git objects", async () => {
    const { api, fixture } = remote();
    const fetched = await api.read();
    const requests = fixture.state.requests.length;
    await expect(api.prepare(fetched, content(note("x".repeat(2 * 1024 * 1024))))).rejects.toThrow(
      "2 MiB",
    );
    expect(fixture.state.requests).toHaveLength(requests);
  });
  it("turns overlapping edits during a ref race into a persisted conflict", async () => {
    const { a, b, api, fixture } = await pair();
    await edit(a.store, "A racing");
    await edit(b.store, "B racing");
    fixture.state.beforePublish = async () => {
      await syncKnowledge(b.store, api);
    };
    expect(await syncKnowledge(a.store, api)).toBe("conflicts");
    expect(a.store.getSnapshot().conflicts[0]).toMatchObject({
      local: { body: "A racing" },
      remote: { body: "B racing" },
    });
    expect((await api.read()).content.notes["note-one"]!.body).toBe("B racing");
  });
  it("pushes, pulls, preserves unrelated files and avoids redundant commits", async () => {
    const { a, b, fixture, api } = await pair();
    expect(contentOf(a.store.getSnapshot())).toEqual(contentOf(b.store.getSnapshot()));
    expect(fixture.files()["other/keep.txt"]).toBe("untouched");
    const head = fixture.state.head;
    await syncKnowledge(a.store, api);
    expect(fixture.state.head).toBe(head);
    expect(pendingCount(a.store.getSnapshot())).toBe(0);
    expect(
      fixture.state.requests
        .filter((r: { method: string }) => r.method === "PATCH")
        .every((r: { body: { force: boolean } }) => r.body.force === false),
    ).toBe(true);
  });
  it("automatically merges separate edits made offline on two devices", async () => {
    const { a, b, api } = await pair();
    await edit(a.store, "FIRST\nmiddle\nlast\n");
    await edit(b.store, "first\nmiddle\nLAST\n");
    await syncKnowledge(a.store, api);
    expect(await syncKnowledge(b.store, api)).toBe("synced");
    await syncKnowledge(a.store, api);
    expect(a.store.getSnapshot().notes["note-one"]!.body).toBe("FIRST\nmiddle\nLAST\n");
    expect(contentOf(a.store.getSnapshot())).toEqual(contentOf(b.store.getSnapshot()));
  });
  it("persists conflicting versions across reload and can keep both", async () => {
    const { a, b, api, fixture } = await pair();
    await edit(a.store, "A");
    await edit(b.store, "B");
    await syncKnowledge(a.store, api);
    const head = fixture.state.head;
    expect(await syncKnowledge(b.store, api)).toBe("conflicts");
    expect(fixture.state.head).toBe(head);
    const reopened = new KnowledgeStore(b.metadata);
    await reopened.ready;
    expect(reopened.getSnapshot().conflicts).toHaveLength(1);
    await expect(syncKnowledge(reopened, api)).rejects.toThrow("冲突");
    await reopened.resolve(reopened.getSnapshot().conflicts[0]!, "both");
    await syncKnowledge(reopened, api);
    await syncKnowledge(a.store, api);
    expect(
      Object.values(a.store.getSnapshot().notes)
        .map((n) => n.body)
        .sort(),
    ).toEqual(["A", "B"]);
  });
  it("propagates deletion and lets the user explicitly recover a delete/edit conflict", async () => {
    const { a, b, api } = await pair();
    await a.store.deleteNote("note-one");
    await edit(b.store, "keep this draft");
    await syncKnowledge(a.store, api);
    await syncKnowledge(b.store, api);
    const conflict = b.store.getSnapshot().conflicts[0]!;
    expect(conflict.remote).toBeNull();
    await b.store.resolve(conflict, "local");
    await syncKnowledge(b.store, api);
    await syncKnowledge(a.store, api);
    expect(a.store.getSnapshot().notes["note-one"]!.body).toBe("keep this draft");
    await a.store.deleteNote("note-one");
    await syncKnowledge(a.store, api);
    await syncKnowledge(b.store, api);
    expect(b.store.getSnapshot().notes).toEqual({});
  });
  it("recovers an accepted commit with a lost acknowledgement without losing subsequent edits", async () => {
    const { a, api, fixture } = await pair();
    await edit(a.store, "sent");
    fixture.state.loseNextAck = true;
    await expect(syncKnowledge(a.store, api)).rejects.toThrow("无法连接");
    expect(a.store.getSnapshot().sync.pending?.head).toBe(fixture.state.head);
    const reopened = new KnowledgeStore(a.metadata);
    await reopened.ready;
    await edit(reopened, "newer offline edit");
    await syncKnowledge(reopened, api);
    expect((await api.read()).content.notes["note-one"]!.body).toBe("newer offline edit");
    expect(reopened.getSnapshot().sync.pending).toBeNull();
  });
  it("recovers if the final local write fails after remote publication", async () => {
    const { a, api, fixture } = await pair();
    await edit(a.store, "remote succeeded");
    fixture.state.beforePublish = async () => a.fail(true);
    await expect(syncKnowledge(a.store, api)).rejects.toThrow("disk full");
    a.fail(false);
    await syncKnowledge(a.store, api);
    expect(a.store.getSnapshot().sync.head).toBe(fixture.state.head);
    expect(pendingCount(a.store.getSnapshot())).toBe(0);
  });
  it("rebases edits made during a network request without marking them synced", async () => {
    const { a, api, fixture } = await pair();
    await edit(a.store, "in flight");
    fixture.state.beforePublish = () => edit(a.store, "newer draft");
    await syncKnowledge(a.store, api);
    expect(a.store.getSnapshot().notes["note-one"]!.body).toBe("newer draft");
    expect((await api.read()).content.notes["note-one"]!.body).toBe("in flight");
    expect(pendingCount(a.store.getSnapshot())).toBe(1);
    await syncKnowledge(a.store, api);
    expect(pendingCount(a.store.getSnapshot())).toBe(0);
  });
  it("retries a non-fast-forward push with the new remote tree", async () => {
    const { a, api, fixture } = await pair();
    await edit(a.store, "local");
    fixture.state.beforePublish = async () => {
      fixture.advance({ "outside.md": "concurrent remote commit" });
    };
    await syncKnowledge(a.store, api);
    expect(fixture.files()["outside.md"]).toBe("concurrent remote commit");
    expect((await api.read()).content.notes["note-one"]!.body).toBe("local");
  });
  it("stops on rewritten history without publishing", async () => {
    const { a, api, fixture } = await pair();
    fixture.state.head = fixture.initial;
    const writes = fixture.state.requests.filter(
      (r: { method: string }) => r.method === "PATCH",
    ).length;
    await expect(syncKnowledge(a.store, api)).rejects.toThrow("历史已重写");
    expect(
      fixture.state.requests.filter((r: { method: string }) => r.method === "PATCH"),
    ).toHaveLength(writes);
  });
  it.each(["public", "truncated", "symlink", "corrupt"])(
    "refuses unsafe remote state (%s)",
    async (kind) => {
      const { a, api, fixture } = await pair();
      const local = a.raw();
      if (kind === "public") fixture.state.private = false;
      if (kind === "truncated") fixture.state.truncated = true;
      if (kind === "symlink") fixture.state.mode = "120000";
      if (kind === "corrupt") fixture.advance({ "knowledge/notes/note-one.md": "broken metadata" });
      const head = fixture.state.head;
      await expect(syncKnowledge(a.store, api)).rejects.toThrow();
      expect(fixture.state.head).toBe(head);
      expect(a.raw()).toBe(local);
    },
  );
  it("reads and restores a previous remote version without rewinding Git", async () => {
    const { a, api } = await pair();
    await edit(a.store, "second version");
    await syncKnowledge(a.store, api);
    const history = await api.history("note-one");
    expect(history).toHaveLength(2);
    const previous = await api.noteAt(history[1]!.sha, "note-one");
    expect(previous.body).toBe(note().body);
    await a.store.restore(previous);
    await syncKnowledge(a.store, api);
    expect(await api.history("note-one")).toHaveLength(3);
  });
});
