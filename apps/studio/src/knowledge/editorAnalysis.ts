import type { EditorState, Text } from "@codemirror/state";
import { analyzeMarkdown, type NoteAnalysis } from "./markdownAnalysis";

// Immutable CodeMirror documents share one analysis across editor consumers.
// Weak keys allow replaced documents to be collected with their editor history.
const cache = new WeakMap<Text, NoteAnalysis>();
export function editorAnalysis(state: EditorState): NoteAnalysis {
  let analysis = cache.get(state.doc);
  if (!analysis) {
    analysis = analyzeMarkdown(state.doc.toString());
    cache.set(state.doc, analysis);
  }
  return analysis;
}
