import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { knowledgeMarkdownLanguage } from "../src/knowledge/editor/markdownEditor";
import {
  linkTip,
  listDepth,
  planLiveMarks,
  type LiveMark,
} from "../src/knowledge/editor/livePreview";
import { newNote } from "../src/knowledge/session/model";
import { liveComposition } from "../src/knowledge/editor/liveSelection";

function plan(text: string, focusAt?: { from: number; to?: number }) {
  const state = EditorState.create({
    doc: text,
    ...(focusAt && { selection: { anchor: focusAt.from, head: focusAt.to ?? focusAt.from } }),
    extensions: [knowledgeMarkdownLanguage],
  });
  return planLiveMarks(state, focusAt !== undefined);
}

const only = (marks: LiveMark[], kind: LiveMark["kind"]) =>
  marks.filter((mark) => mark.kind === kind);

describe("live preview decoration plan", () => {
  it("reveals the active inline element and preserves heading layout while editing its text", () => {
    const text = "# Title\n\n**bold** here";
    const all = plan(text);
    expect(only(all, "hide")).toEqual([
      { kind: "hide", from: 0, to: 2 }, // "# " 标题前缀
      { kind: "hide", from: 9, to: 11 }, // 加粗的 ** 开
      { kind: "hide", from: 15, to: 17 }, // 加粗的 ** 合
    ]);
    // 光标在加粗所在行：该行恢复原文，标题前缀仍然退场。
    const onBold = plan(text, { from: 15 });
    expect(only(onBold, "hide")).toEqual([{ kind: "hide", from: 0, to: 2 }]);
    // 编辑标题正文保留排版；进入前缀时可直接修改标题级别。
    const onHeading = plan(text, { from: 5 });
    expect(only(onHeading, "hide")).toHaveLength(3);
    expect(only(plan(text, { from: 0 }), "hide")).toHaveLength(2);
    // 未聚焦：全部渲染。
    expect(only(plan(text), "hide")).toHaveLength(3);
  });

  it("reveals intersected elements without revealing prefixes outside the selection", () => {
    const text = "# Title\n\n**bold** here";
    const spans = plan(text, { from: 3, to: 15 });
    expect(only(spans, "hide")).toEqual([{ kind: "hide", from: 0, to: 2 }]);
    const next = "**first**\n**second**";
    expect(only(plan(next, { from: 0, to: 10 }), "hide")).toEqual([
      { kind: "hide", from: 10, to: 12 },
      { kind: "hide", from: 18, to: 20 },
    ]);
  });

  it("renders list markers as bullets, ordinals and checkboxes off the cursor line", () => {
    const text = "- a\n  - b\n1. c\n- [ ] todo\n- [x] done";
    const marks = plan(text);
    expect(only(marks, "bullet")).toEqual([
      { kind: "bullet", from: 0, to: 1, depth: 0 },
      { kind: "bullet", from: 6, to: 7, depth: 1 },
    ]);
    expect(only(marks, "ordinal")).toEqual([{ kind: "ordinal", from: 10, to: 12 }]);
    expect(only(marks, "task")).toEqual([
      { kind: "task", from: 15, to: 20, checked: false, marker: 3 },
      { kind: "task", from: 26, to: 31, checked: true, marker: 3 },
    ]);
    // 光标所在行显示原始标记。
    const onTask = plan(text, { from: 17 });
    expect(only(onTask, "task")).toEqual([
      { kind: "task", from: 26, to: 31, checked: true, marker: 3 },
    ]);
  });

  it("chips wiki and markdown links and gives inline code a quiet background", () => {
    const text = "See [Go](note.md#h) and [[id|Label]] and `code`.";
    const marks = plan(text);
    const label = text.indexOf("Go");
    expect(only(marks, "link-chip")).toEqual([
      { kind: "link-chip", from: label, to: label + 2, target: "note.md#h" },
    ]);
    const wiki = text.indexOf("[[id|Label]]");
    expect(only(marks, "chip")).toEqual([
      { kind: "chip", from: wiki, to: wiki + 12, label: "Label", target: "id" },
    ]);
    const code = text.indexOf("`code`");
    expect(only(marks, "code")).toEqual([{ kind: "code", from: code, to: code + 6 }]);
    // wiki 部件接管整段：段内不再产生任何退场/背景标记。
    expect(
      marks.filter(
        (mark) =>
          mark.kind !== "line" &&
          mark.kind !== "chip" &&
          mark.kind !== "link-chip" &&
          "to" in mark &&
          mark.from >= wiki &&
          mark.to <= wiki + 12,
      ),
    ).toHaveLength(0);
    // 光标行：退场标记恢复原文；chip 是不隐藏文本的稳定包裹，必须保留，
    // 否则 mousedown 瞬间元素被重建，click 事件丢失。
    const onLabel = plan(text, { from: label + 1 });
    expect(only(onLabel, "hide")).toHaveLength(2); // Other inline code remains rendered.
    expect(only(onLabel, "link-chip")).toHaveLength(1);
    expect(only(plan(text, { from: wiki + 1 }), "chip")).toHaveLength(0);
  });

  it("reveals only the touched element on a line with several formats, including boundaries", () => {
    const text = "普通 **加粗** 文字 *斜体* [链接](note.md) 和 `code`";
    const bold = { from: text.indexOf("**"), to: text.indexOf("**") + 6 };
    const all = only(plan(text, { from: 1 }), "hide");
    for (const cursor of [bold.from, bold.from + 3, bold.to]) {
      const marks = only(plan(text, { from: cursor }), "hide");
      expect(marks).toEqual(all.filter((mark) => mark.from < bold.from || mark.from >= bold.to));
      expect(
        marks.some((mark) => text.slice(mark.from, "to" in mark ? mark.to : mark.from) === "*"),
      ).toBe(true);
    }
    expect(only(plan(text, { from: text.indexOf("文字") }), "hide")).toEqual(all);
  });

  it("renders inline formats and tasks within quotes while leaving code examples literal", () => {
    const text =
      "> **引用** [链接](note.md)\n> - [ ] 任务\n\n```md\n**literal** [[not-a-note]]\n```";
    const marks = plan(text);
    expect(only(marks, "task")).toHaveLength(1);
    expect(only(marks, "link-chip")).toHaveLength(1);
    expect(only(marks, "chip")).toHaveLength(0);
    const code = text.indexOf("**literal**");
    expect(only(plan(text, { from: text.indexOf("```md") + 1 }), "line")).toEqual(
      only(marks, "line"),
    );
    expect(
      only(marks, "hide").some((mark) => mark.from >= code && mark.from < text.lastIndexOf("```")),
    ).toBe(false);
    expect(
      only(marks, "hide").some((mark) => mark.from === 0 && "to" in mark && mark.to === 2),
    ).toBe(true);
  });

  it("lets attachment widgets exclusively own local image and standalone file references", () => {
    const text =
      "![图片](attachment:img)\n\n[文档](attachment:doc)\n\n![引用图片][img]\n\n[引用文件][doc]\n\n[img]: attachment:img\n[doc]: attachment:doc";
    const marks = plan(text);
    expect(only(marks, "hide")).toHaveLength(0);
    expect(only(marks, "link-chip")).toHaveLength(0);
  });
  it("renders externally resolved reference links without changing their shared definitions", () => {
    const source = '[参考][ref]\n\n[ref]: https://example.com "title"';
    expect(only(plan(source), "link-chip")).toEqual([
      { kind: "link-chip", from: 1, to: 3, target: "https://example.com" },
    ]);
  });

  it("locates task markers through nested quote and list containers", () => {
    for (const text of ["> - [ ] 引用", "- > - [ ] 嵌套", "- - [x] 双层"]) {
      const task = only(plan(text), "task")[0];
      expect(task?.kind).toBe("task");
      if (task?.kind === "task") {
        const at = task.from + task.marker;
        expect(text.slice(at - 1, at + 2)).toMatch(/^\[[ xX]\]$/u);
      }
    }
  });

  it("establishes the composition guard from native compose transactions without DOM events", () => {
    const state = EditorState.create({ doc: "正文", extensions: [liveComposition] });
    const composed = state.update({
      changes: { from: 1, insert: "中" },
      userEvent: "input.type.compose",
    }).state;
    expect(composed.field(liveComposition)).toBe(true);
    expect(composed.update({ selection: { anchor: 0 } }).state.field(liveComposition)).toBe(true);
    expect(state.field(liveComposition)).toBe(false);
  });

  it("bounds long block line decorations to the visible window", () => {
    const text = "```\n" + "const x = 1;\n".repeat(10_000) + "```";
    const state = EditorState.create({ doc: text, extensions: [knowledgeMarkdownLanguage] });
    const from = state.doc.line(100).from,
      to = state.doc.line(110).to;
    const marks = planLiveMarks(state, false, [{ from, to }]);
    expect(marks.length).toBeGreaterThan(0);
    expect(marks.length).toBeLessThanOrEqual(11);
    expect(marks.every((mark) => mark.from >= from && mark.from <= to)).toBe(true);
    expect(state.doc.toString()).toBe(text);
  });
});

describe("listDepth", () => {
  it("maps 2/4-space indents to nesting levels", () => {
    expect(listDepth("- a", 0)).toBe(0);
    expect(listDepth("  - b", 2)).toBe(1);
    expect(listDepth("    - c", 4)).toBe(2);
    expect(listDepth("\t- d", 1)).toBe(1);
  });
});

describe("linkTip", () => {
  const note = { ...newNote("目标标题"), id: "n1" };

  it("shows the resolved note title and keeps the raw target as detail", () => {
    expect(linkTip(() => [note], "n1")).toEqual({ main: "目标标题", detail: "n1" });
  });

  it("falls back to the raw target when nothing resolves", () => {
    expect(linkTip(() => [], "https://example.com/a.md")).toEqual({
      main: "https://example.com/a.md",
    });
  });

  it("never throws on resolution failures", () => {
    expect(
      linkTip(() => {
        throw new Error("boom");
      }, "x"),
    ).toEqual({ main: "x" });
  });
});
