import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { analyzedDocument, liveFacts } from "../src/knowledge/editor/liveAnalysis";
import { markdownFacts } from "../src/knowledge/notes/markdownAnalysis";
import { knowledgeMarkdownLanguage } from "../src/knowledge/editor/markdownEditor";
import { liveEditorFacts } from "../src/knowledge/editor/editorAnalysis";

function analyzed(source: string) {
  const state = EditorState.create({
    doc: source,
    extensions: [knowledgeMarkdownLanguage, liveFacts],
  });
  return state.update({
    effects: analyzedDocument.of({ doc: state.doc, facts: markdownFacts(source) }),
  }).state;
}
describe("asynchronous live analysis", () => {
  it("immediately suppresses old widgets when surrounding syntax turns them into code", () => {
    const source = "![图](attachment:image)\n\n[[note|别名]]";
    for (const prefix of ["```md\n", "<div>\n\n", "    "]) {
      const state = analyzed(source);
      const next = state.update({ changes: { from: 0, insert: prefix } }).state;
      expect(liveEditorFacts(next).attachments).toEqual([]);
      if (prefix === "```md\n") expect(liveEditorFacts(next).analysis.links).toEqual([]);
    }
    const state = analyzed("前文 [[note]]");
    const next = state.update({ changes: { from: 2, to: 3, insert: "\\" } }).state;
    expect(liveEditorFacts(next).analysis.links).toEqual([]);
  });
  it("maps untouched attachment/wiki ranges without rewriting the text or keeping touched markup", () => {
    const source = "开头\n\n![图](attachment:image)\n\n[[note|别名]]";
    const state = analyzed(source);
    const next = state.update({ changes: { from: 0, insert: "新" } }).state;
    expect(next.field(liveFacts).attachments[0]?.from).toBe(source.indexOf("![") + 1);
    expect(next.field(liveFacts).analysis.links[0]?.from).toBe(source.indexOf("[[") + 1);
    const touched = next.update({
      changes: { from: next.doc.toString().indexOf("image"), insert: "x" },
    }).state;
    expect(touched.field(liveFacts).attachments).toEqual([]);
    expect(touched.field(liveFacts).analysis.links).toHaveLength(1);
    expect(state.doc.toString()).toBe(source);
  });
  it("rejects a completed parse for an obsolete document", () => {
    const state = analyzed("[[old]]");
    const next = state.update({
      changes: { from: 0, to: state.doc.length, insert: "[[new]]" },
    }).state;
    const stale = next.update({
      effects: analyzedDocument.of({ doc: state.doc, facts: markdownFacts("[[old]]") }),
    }).state;
    expect(stale.field(liveFacts).analysis.links).toEqual([]);
    const current = stale.update({
      effects: analyzedDocument.of({ doc: stale.doc, facts: markdownFacts("[[new]]") }),
    }).state;
    expect(current.field(liveFacts).analysis.links[0]?.target).toBe("new");
  });
  it("invalidates shared destinations immediately when a definition changes", () => {
    const source = "![图][ref]\n\n[ref]: attachment:old";
    const state = analyzed(source);
    expect(state.field(liveFacts).attachments[0]?.id).toBe("old");
    const next = state.update({
      changes: { from: source.indexOf("old"), to: source.length, insert: "new" },
    }).state;
    expect(next.field(liveFacts).attachments).toEqual([]);
    const finished = next.update({
      effects: analyzedDocument.of({ doc: next.doc, facts: markdownFacts(next.doc.toString()) }),
    }).state;
    expect(finished.field(liveFacts).attachments[0]?.id).toBe("new");
  });
  it.each(["- [ref]: attachment:old", "1. [ref]: attachment:old", "[ref]:\n  attachment:old"])(
    "invalidates nested and multiline shared definitions: %s",
    (definition) => {
      const source = `![图][ref]\n\n${definition}`;
      const state = analyzed(source);
      expect(liveEditorFacts(state).attachments[0]?.id).toBe("old");
      const next = state.update({
        changes: { from: source.indexOf("old"), to: source.length, insert: "new" },
      }).state;
      expect(liveEditorFacts(next).attachments).toEqual([]);
    },
  );
});
