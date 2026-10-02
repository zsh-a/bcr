import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { history, undo, undoDepth } from "@codemirror/commands";
import { knowledgeMarkdownLanguage } from "../src/knowledge/editor/markdownEditor";
import {
  editorBlocks,
  inlineFormat,
  insertBlock,
  lineFormat,
  proseContext,
} from "../src/knowledge/editor/editorCommands";
import {
  editorLinkAt,
  editorLinkMarkdown,
  editorUnlink,
  safeEditorLink,
  targetValid,
  type EditorTarget,
} from "../src/knowledge/editor/editorContext";
import { analyzeEditorLinks, analyzeMarkdown } from "../src/knowledge/notes/markdownAnalysis";
import { localDay } from "../src/knowledge/editor/format";

function state(doc: string, from = 0, to = from) {
  return EditorState.create({
    doc,
    selection: { anchor: from, head: to },
    extensions: [knowledgeMarkdownLanguage, history()],
  });
}
function target(current: EditorState, pos = current.selection.main.head): EditorTarget {
  const view = { state: current, dom: { isConnected: true } } as unknown as EditorView;
  return {
    view,
    doc: current.doc,
    from: current.selection.main.from,
    to: current.selection.main.to,
    pos,
    x: 0,
    y: 0,
    link: editorLinkAt(current, pos),
  };
}

describe("editor transactions", () => {
  it("uses longer code delimiters when needed and allows removing code at the caret", () => {
    const initial = state("调用 `code`", 0, 9);
    const next = initial.update(inlineFormat(initial, "`")).state;
    expect(next.doc.toString()).toBe("`` 调用 `code` ``");
    expect(next.update(inlineFormat(next, "`")).state.doc.toString()).toBe(" 调用 `code` ");
    const caret = state("`code`", 3);
    expect(caret.update(inlineFormat(caret, "`")).state.doc.toString()).toBe("code");
    const empty = state("", 0);
    const inserted = empty.update(inlineFormat(empty, "`")).state;
    expect(inserted.update(inlineFormat(inserted, "`")).state.doc.toString()).toBe("");
  });
  it("toggles formatting, retains the text selection, and can undo in one step", () => {
    const initial = state("正文：重点。", 3, 5);
    const next = initial.update(inlineFormat(initial, "**")).state;
    expect(next.doc.toString()).toBe("正文：**重点**。");
    expect(next.sliceDoc(next.selection.main.from, next.selection.main.to)).toBe("重点");
    expect(next.update(inlineFormat(next, "**")).state.doc.toString()).toBe(initial.doc.toString());
    expect(undoDepth(next)).toBe(1);
    let undone = next;
    undo({
      state: next,
      dispatch: (transaction) => {
        undone = transaction.state;
      },
    });
    expect(undone.doc.toString()).toBe(initial.doc.toString());
  });
  it("does not mistake bold delimiters for italic delimiters", () => {
    const current = state("**重点**", 2, 4);
    const next = current.update(inlineFormat(current, "*")).state;
    expect(next.doc.toString()).toBe("***重点***");
    expect(next.update(inlineFormat(next, "*")).state.doc.toString()).toBe("**重点**");
    const all = state("**重点**", 0, 6);
    expect(all.update(inlineFormat(all, "*")).state.doc.toString()).toBe("***重点***");
  });
  it("inserts empty delimiters with the caret between them", () => {
    const current = state("正文", 1);
    const next = current.update(inlineFormat(current, "~~")).state;
    expect(next.doc.toString()).toBe("正~~~~文");
    expect(next.selection.main.head).toBe(3);
    expect(next.update(inlineFormat(next, "~~")).state.doc.toString()).toBe("正文");
  });
  it("changes complete selected lines and excludes the next line at a selection boundary", () => {
    const current = state("# 一\n  - 二\n三", 0, 10);
    const next = current.update(lineFormat(current, "- [ ] ")).state;
    expect(next.doc.toString()).toBe("- [ ] 一\n  - [ ] 二\n三");
    expect(next.update(lineFormat(next, "- [ ] ")).state.doc.toString()).toBe("一\n  二\n三");
  });
  it("uses the same insertion registry for slash/menu and puts the caret inside a code block", () => {
    const current = state("前文后文", 2);
    const next = current.update(insertBlock(current, "code")).state;
    expect(next.doc.toString()).toBe("前文\n```\n\n```\n后文");
    expect(next.doc.sliceString(next.selection.main.head - 1, next.selection.main.head + 1)).toBe(
      "\n\n",
    );
    expect(editorBlocks.find((block) => block.id === "date")?.text()).toBe(localDay());
  });
  it("keeps prose formatting out of code, HTML, images and links", () => {
    const current = state(
      "正文\n\n`code`\n\n```js\nconst x = 1\n```\n\n[链接](https://example.com)",
    );
    expect(proseContext(current, 1)).toBe(true);
    expect(proseContext(current, 7)).toBe(false);
    expect(proseContext(current, current.doc.toString().indexOf("const"))).toBe(false);
    expect(proseContext(current, current.doc.toString().indexOf("链接"))).toBe(false);
  });
});

describe("editor link context", () => {
  it("recognizes external/reference/wiki links without putting external links into the relationship index", () => {
    const source =
      '[[知识|笔记]] [外链](https://example.com/a_(b)) [**参考**][r]\n\n[r]: https://example.org "提示"\n\n`[代码](https://code.test)`\n\n\\[[转义]]';
    const links = analyzeEditorLinks(source);
    expect(links.map((link) => [link.label, link.internal])).toEqual([
      ["笔记", true],
      ["外链", false],
      ["参考", false],
    ]);
    expect(analyzeMarkdown(source).links.map((link) => link.target)).toEqual(["知识"]);
    const current = state(source);
    expect(editorLinkAt(current, source.indexOf("外链"))?.url).toBe("https://example.com/a_(b)");
    expect(editorLinkAt(current, source.indexOf("代码"))).toBeUndefined();
  });
  it("preserves inline label formatting, angle brackets and titles when changing a destination", () => {
    const source = '[**名称**](<https://example.com> "提示")';
    const current = target(state(source), 4);
    expect(editorLinkMarkdown(current, "名称", "https://next.test/a(b)")).toBe(
      '[**名称**](<https://next.test/a%28b%29> "提示")',
    );
    expect(editorUnlink(current)).toBe("**名称**");
  });
  it("edits only the clicked reference while preserving its formatted label and shared title", () => {
    const source = '[**参考**][r] [第二处][r]\n\n[r]: https://example.com "提示"';
    const current = target(state(source), 4);
    expect(editorLinkMarkdown(current, "参考", "目标笔记.md")).toBe(
      '[**参考**](目标笔记.md "提示")',
    );
    expect(current.doc.toString()).toBe(source);
  });
  it("creates safe Markdown labels and allows internal names with spaces", () => {
    const current = target(state("待链接", 0, 3));
    expect(editorLinkMarkdown(current, "名称 [一]", "我的 笔记.md")).toBe(
      "[名称 \\[一\\]](我的%20笔记.md)",
    );
    expect(safeEditorLink("我的 笔记.md#小节")).toBe(true);
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,hi",
      "file:///etc/passwd",
      "//example.com",
      "https://e.test\nspoof",
    ])
      expect(safeEditorLink(url)).toBe(false);
    for (const url of ["https://e.test", "http://e.test", "mailto:a@e.test", "笔记.md", "#标题"])
      expect(safeEditorLink(url)).toBe(true);
  });
  it("keeps wiki links internal and rejects delimiters that could break them", () => {
    const current = target(state("[[知识|笔记]]"), 2);
    expect(editorLinkMarkdown(current, "改名", "stable-id")).toBe("[[stable-id|改名]]");
    expect(() => editorLinkMarkdown(current, "标签|破坏", "stable-id")).toThrow();
    expect(editorLinkMarkdown(current, "笔记", "https://example.com")).toBe(
      "[笔记](https://example.com)",
    );
  });
});

describe("pending clipboard/dialog targets", () => {
  it("rejects changed text, selections, detached editors and read-only transitions", () => {
    const current = state("原文", 0, 2),
      captured = target(current);
    expect(targetValid(captured)).toBe(true);
    const readonly = EditorState.create({
      doc: "原文",
      selection: { anchor: 0, head: 2 },
      extensions: [EditorState.readOnly.of(true)],
    });
    Object.assign(captured.view, { state: current.update({ selection: { anchor: 1 } }).state });
    expect(targetValid(captured)).toBe(false);
    Object.assign(captured.view, {
      state: current.update({ changes: { from: 0, insert: "改变" } }).state,
    });
    expect(targetValid(captured)).toBe(false);
    Object.assign(captured.view, { state: readonly });
    const locked = { ...captured, doc: readonly.doc };
    expect(targetValid(locked)).toBe(false);
    expect(targetValid(locked, false)).toBe(true);
    Object.assign(captured.view, { state: current, dom: { isConnected: false } });
    expect(targetValid(captured, false)).toBe(false);
  });
});
