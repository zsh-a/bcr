import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import {
  analyzeMarkdown,
  analyzeEditorLinks,
  markdownFacts,
  noteCharacterCount,
  notePlainText,
} from "../src/knowledge/notes/markdownAnalysis";
import { attachmentReferences } from "../src/knowledge/attachments/attachmentModel";
import {
  editorAnalysis,
  editorAttachments,
  editorFacts,
} from "../src/knowledge/editor/editorAnalysis";

describe("shared Markdown facts", () => {
  it("derives links, references and counts from one consistent input snapshot", () => {
    const source =
      "# 标题\n\n[[note|别名]] [外链](https://example.com)\n\n![图](attachment:picture?width=320) [文件][file]\n\n[file]: attachment:document";
    const facts = markdownFacts(source),
      state = EditorState.create({ doc: source });
    expect(analyzeMarkdown(source)).toBe(facts.analysis);
    expect(analyzeEditorLinks(source)).toBe(facts.editorLinks);
    expect(attachmentReferences(source)).toBe(facts.attachments);
    expect(editorFacts(state.doc)).toBe(facts);
    expect(editorAnalysis(state)).toBe(facts.analysis);
    expect(editorAttachments(state.doc)).toBe(facts.attachments);
    expect(facts.attachments.map((ref) => ref.id)).toEqual(["picture", "document"]);
    expect(facts.characters).toBe("标题别名外链".length);
  });
  it("counts what reading displays for escaped/entity aliases, nested quotes and code", () => {
    for (const source of [
      "\\[[n|甲]] [[n|甲]]",
      "&#91;&#91;n|甲]] [[n|甲]]",
      "[[n|甲&amp;乙]] [[x|🙂]]",
      "> 一 [[n|别名]]\n> 二 [[x|🙂]]",
      "`[[n|代码]]`\n\n```md\n[[n|代码]]\n```",
      "普通文本 [[note|别名]] ".repeat(300),
      "[外链 [[note|别名]]](https://example.com)",
      "[外链 [[note|别名]]][r]\n\n[r]: https://example.com",
    ]) {
      expect(noteCharacterCount(source)).toBe(
        Array.from(notePlainText(source).replace(/\s/gu, "")).length,
      );
    }
    expect(notePlainText("\\[[n|甲]] [[n|甲]]")).toBe("[[n|甲]] 甲");
    expect(notePlainText("[附件][r]\n\n[r]: attachment:file")).toBe("");
    expect(notePlainText("[参考][r]", "[参考][r]\n\n[r]: https://example.com")).toBe("参考");
    expect(notePlainText("[附件][r]", "[附件][r]\n\n[r]: attachment:file")).toBe("");
  });
  it("keeps derived facts intact when rendering or replacing documents", () => {
    const source = "# 标题\n\n[[note|别名]]";
    const facts = markdownFacts(source),
      snapshot = JSON.stringify(facts);
    notePlainText(source);
    expect(JSON.stringify(facts)).toBe(snapshot);
    const state = EditorState.create({ doc: source });
    const next = state.update({
      changes: { from: 0, to: state.doc.length, insert: "# 新标题\n\n![新图](attachment:new)" },
    }).state;
    expect(editorAnalysis(next).headings[0]?.text).toBe("新标题");
    expect(editorAttachments(next.doc)[0]?.id).toBe("new");
    expect(editorFacts(state.doc).analysis.links[0]?.label).toBe("别名");
  });
});
