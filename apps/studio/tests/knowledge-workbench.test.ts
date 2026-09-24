import { describe, expect, it } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import type { Root } from "mdast";
import { EditorState } from "@codemirror/state";
import { history, undoDepth, undo } from "@codemirror/commands";
import {
  analyzeMarkdown,
  KnowledgeLinkIndex,
  noteWikiLink,
  resolveNoteLink,
  remarkKnowledgeLinks,
  internalTarget,
} from "../src/knowledge/markdownAnalysis";
import { newNote } from "../src/knowledge/model";
import { EditorSessions } from "../src/knowledge/editorSessions";
import {
  decodeWorkbench,
  emptyWorkbench,
  visitNote,
  toggleFavorite,
  fillTemplate,
  localDay,
} from "../src/knowledge/workbench";
import { createWorkspaceServices } from "../src/workspace";
import { createKnowledgeActions } from "../src/knowledge/actions";
import { editorAnalysis } from "../src/knowledge/editorAnalysis";

describe("knowledge Markdown relationships", () => {
  it("shares parser semantics across editor consumers and caches immutable documents", () => {
    const source =
      "\\[[escaped]] \\\\[[valid]] ![[embed]] `[[code]]`\n\n[[target|label]] [inline](target.md)";
    const state = EditorState.create({ doc: source });
    const first = editorAnalysis(state);
    expect(first.links.map((link) => link.target)).toEqual(["valid", "target", "target"]);
    expect(first).toEqual(analyzeMarkdown(source));
    expect(editorAnalysis(state.update({ selection: { anchor: 2 } }).state)).toBe(first);
    const changed = state.update({
      changes: { from: 0, to: state.doc.length, insert: "[[new]]" },
    }).state;
    expect(editorAnalysis(changed).links.map((link) => link.target)).toEqual(["new"]);
  });
  it("extracts headings, aliases and normal Markdown links, excluding code, escapes, HTML and embeds", () => {
    const body =
      "# 第一节\n\n[[目标|显示名称]] [正文](目标.md#小节)\n\n`[[inline]]`\n\n```md\n# not heading\n[[fenced]]\n```\n\n    [[indented]]\n\n\\[[escaped]] ![[embed]]\n\n<!-- [[comment]] -->";
    const result = analyzeMarkdown(body);
    expect(result.headings).toEqual([{ text: "第一节", depth: 1, from: 0 }]);
    expect(result.links.map((link) => link.target)).toEqual(["目标", "目标#小节"]);
    expect(body.slice(result.links[0]!.from, result.links[0]!.to)).toBe("[[目标|显示名称]]");
  });
  it("does not transform an escaped duplicate instead of the real link", () => {
    const source = "\\[[target]] &amp; [[target]]";
    const processor = unified().use(remarkParse).use(remarkKnowledgeLinks);
    const tree = processor.runSync(processor.parse(source), { value: source }) as Root;
    expect(tree.children[0]).toMatchObject({
      type: "paragraph",
      children: [
        { type: "text", value: "[[target]] & " },
        { type: "link", url: "#knowledge-link=target" },
        { type: "text", value: "" },
      ],
    });
  });
  it("resolves stable identity and heading-only links; ambiguous titles remain ambiguous", () => {
    const a = { ...newNote("相同标题"), id: "first" },
      b = { ...newNote("相同标题"), id: "second" };
    expect(resolveNoteLink([a, b], "相同标题")).toHaveLength(2);
    expect(resolveNoteLink([a, b], "first#章节")).toEqual([a]);
    expect(resolveNoteLink([a, b], "#章节", "second")).toEqual([b]);
    const generated = analyzeMarkdown(noteWikiLink(a)).links[0]!;
    expect(resolveNoteLink([{ ...a, title: "已重命名" }, b], generated.target)[0]?.id).toBe(
      "first",
    );
    expect(
      analyzeMarkdown(noteWikiLink({ ...a, title: "**重点** `代码` [链接] & <标签>" })).links[0]
        ?.target,
    ).toBe("first");
    expect(internalTarget("javascript:alert(1)")).toBeNull();
    expect(internalTarget("https://example.com/a.md")).toBeNull();
    expect(internalTarget("%E0%A4%A")).toBeNull();
  });
  it("invalidates changed/deleted documents and excludes ambiguous backlink matches", () => {
    const index = new KnowledgeLinkIndex();
    const a = { ...newNote("A"), id: "a" },
      b = { ...newNote("B"), id: "b", body: "[[A]]" };
    index.update([a, b]);
    const cached = index.get("b");
    expect(index.backlinks([a, b], "a")).toEqual([b]);
    index.update([{ ...a }, { ...b }]);
    expect(index.get("b")).toBe(cached);
    expect(index.backlinks([a, b, { ...a, id: "duplicate" }], "a")).toEqual([]);
    const changed = { ...b, body: "[[Missing]]" };
    index.update([a, changed]);
    expect(index.backlinks([a, changed], "a")).toEqual([]);
    index.update([a]);
    expect(index.get("b").links).toEqual([]);
  });
});

describe("editor sessions", () => {
  it("restores undo, selection and scroll with new callbacks, not another note's history", () => {
    const sessions = new EditorSessions();
    let state = EditorState.create({ doc: "before", extensions: [history()] });
    state = state.update({
      changes: { from: 6, insert: " after" },
      selection: { anchor: 12 },
      userEvent: "input",
    }).state;
    sessions.save("a", state, 150);
    const restored = sessions.restore("a", "before after", {
      doc: "before after",
      extensions: [history()],
    });
    expect(restored.scroll).toBe(150);
    expect(restored.state.selection.main.head).toBe(12);
    expect(undoDepth(restored.state)).toBe(1);
    undo({
      state: restored.state,
      dispatch: (transaction) => {
        state = transaction.state;
      },
    });
    expect(state.doc.toString()).toBe("before");
    expect(
      undoDepth(
        sessions.restore("b", "before after", { doc: "before after", extensions: [history()] })
          .state,
      ),
    ).toBe(0);
    expect(
      undoDepth(sessions.restore("a", "remote", { doc: "remote", extensions: [history()] }).state),
    ).toBe(0);
    sessions.delete("a");
    expect(
      sessions.restore("a", "before after", { doc: "before after", extensions: [history()] })
        .scroll,
    ).toBe(0);
  });
});

describe("personal workspace", () => {
  it("validates optional UI state and bounds open tabs", () => {
    expect(decodeWorkbench("bad")).toEqual(emptyWorkbench());
    expect(
      decodeWorkbench(
        JSON.stringify({ version: 1, tabs: ["a", "a", "__proto__"], favorites: [false, "b"] }),
      ),
    ).toEqual({ tabs: ["a"], recent: [], favorites: ["b"] });
    let state = emptyWorkbench();
    for (let i = 0; i < 60; i++) state = visitNote(state, `note-${i}`);
    expect(state.tabs).toHaveLength(20);
    expect(state.recent).toHaveLength(50);
    state = toggleFavorite(state, "note-2");
    expect(state.favorites).toEqual(["note-2"]);
    expect(toggleFavorite(state, "note-2").favorites).toEqual([]);
  });
  it("uses local dates and supports templates without executing code", () => {
    const date = new Date(2026, 8, 23, 1);
    expect(localDay(date)).toBe("2026-09-23");
    expect(fillTemplate("{{title}} · {{date}} · {{unknown}}", "读书", date)).toBe(
      "读书 · 2026-09-23 · {{unknown}}",
    );
  });
  it("creates daily notes idempotently, preserves edits, and honors the save barrier", async () => {
    const data = new Map<string, string>();
    const workspace = createWorkspaceServices({
      get: async (key) => data.get(key),
      set: async (key, value) => {
        data.set(key, value);
      },
    });
    const actions = createKnowledgeActions(workspace.knowledge, workspace.research, async () => {});
    const date = new Date(2026, 8, 23);
    const [a, b] = await Promise.all([actions.daily(date), actions.daily(date)]);
    expect(a).toBe(b);
    const note = workspace.knowledge.getSnapshot().notes[a]!;
    await workspace.knowledge.saveNote({ ...note, body: "保留的日记" }, note);
    await actions.daily(date);
    expect(workspace.knowledge.getSnapshot().notes[a]!.body).toBe("保留的日记");
    const blocked = createKnowledgeActions(workspace.knowledge, workspace.research, async () => {
      throw new Error("save failed");
    });
    await expect(blocked.daily(date)).rejects.toThrow("save failed");
    await workspace.close();
  });
});
