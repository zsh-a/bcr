import type { EditorState, Text } from "@codemirror/state";
import { markdownFacts, type MarkdownFacts } from "../notes/markdownAnalysis";

// Immutable CodeMirror documents share one analysis across editor consumers.
// Weak keys allow replaced documents to be collected with their editor history.
const cache = new WeakMap<Text, MarkdownFacts>();
export function editorFacts(doc: Text) {
  let facts = cache.get(doc);
  if (!facts) {
    facts = markdownFacts(doc.toString());
    cache.set(doc, facts);
  }
  return facts;
}
export function editorAttachments(doc: Text) {
  return editorFacts(doc).attachments;
}
export function editorAnalysis(state: EditorState) {
  return editorFacts(state.doc).analysis;
}
