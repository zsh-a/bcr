import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { knowledgeMarkdownLanguage } from "../src/knowledge/markdownEditor";
import { linkTip, listDepth, planLiveMarks, type LiveMark } from "../src/knowledge/livePreview";
import { newNote } from "../src/knowledge/model";

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
  it("hides syntax marks off the cursor line and reveals the cursor line raw", () => {
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
    // 光标在标题行：标题前缀显示原文，加粗标记退场。
    const onHeading = plan(text, { from: 5 });
    expect(only(onHeading, "hide")).toHaveLength(2);
    // 未聚焦：全部渲染。
    expect(only(plan(text), "hide")).toHaveLength(3);
  });

  it("keeps every line touched by a multi-line selection raw", () => {
    const text = "# Title\n\n**bold** here";
    const spans = plan(text, { from: 3, to: 15 });
    expect(only(spans, "hide")).toHaveLength(0);
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
      { kind: "task", from: 15, to: 20, checked: false },
      { kind: "task", from: 26, to: 31, checked: true },
    ]);
    // 光标所在行显示原始标记。
    const onTask = plan(text, { from: 17 });
    expect(only(onTask, "task")).toEqual([{ kind: "task", from: 26, to: 31, checked: true }]);
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
          mark.from >= wiki &&
          mark.to <= wiki + 12,
      ),
    ).toHaveLength(0);
    // 光标行：退场标记恢复原文；chip 是不隐藏文本的稳定包裹，必须保留，
    // 否则 mousedown 瞬间元素被重建，click 事件丢失。
    const onLabel = plan(text, { from: label + 1 });
    expect(only(onLabel, "hide")).toHaveLength(0);
    expect(only(onLabel, "link-chip")).toHaveLength(1);
    expect(only(plan(text, { from: wiki + 1 }), "chip")).toHaveLength(0);
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
