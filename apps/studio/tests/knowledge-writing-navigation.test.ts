import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { knowledgeMarkdownLanguage } from "../src/knowledge/editor/markdownEditor";
import { livePrefixChange } from "../src/knowledge/editor/liveSelection";
import { notePlainText } from "../src/knowledge/notes/markdownAnalysis";

describe("writing navigation and copying", () => {
  it("removes exactly one heading/quote prefix and preserves containers", () => {
    for (const [source, caret, expected] of [
      ["## 标题", 3, "标题"],
      ["> 引用", 2, "引用"],
      ["> > 引用", 4, "> 引用"],
      ["> ## 标题", 5, "> 标题"],
    ] as const) {
      const state = EditorState.create({
        doc: source,
        selection: { anchor: caret },
        extensions: [knowledgeMarkdownLanguage],
      });
      const change = livePrefixChange(state);
      expect(change).not.toBeNull();
      expect(state.update({ changes: change! }).state.doc.toString()).toBe(expected);
    }
  });
  it("does not treat code, ordinary prose or a selection as a removable prefix", () => {
    for (const [source, anchor, head] of [
      ["```md\n# example\n```", 8, 8],
      ["普通文字", 2, 2],
      ["# 标题", 2, 4],
    ] as const) {
      const state = EditorState.create({
        doc: source,
        selection: { anchor, head },
        extensions: [knowledgeMarkdownLanguage],
      });
      expect(livePrefixChange(state)).toBeNull();
    }
  });
  it("copies rendered text while preserving code, paragraphs and table cell boundaries", () => {
    expect(
      notePlainText(
        "# 标题\n\n**加粗** 与 [链接](https://example.com) [[note|别名]]\n\n```js\nconst x = 1;\n```\n\n| 项目 | 内容 |\n| --- | --- |\n| A | B |\n\n![图片](attachment:pic)\n\n[文件](attachment:file)",
      ),
    ).toBe("标题\n\n加粗 与 链接 别名\n\nconst x = 1;\n\n项目\t内容\nA\tB");
  });
});
