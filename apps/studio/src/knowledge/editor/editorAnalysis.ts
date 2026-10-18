import type { EditorState, Text } from "@codemirror/state";
import { markdownFacts, type MarkdownFacts } from "../notes/markdownAnalysis";
import { liveFacts } from "./liveAnalysis";
import { validateLiveFacts } from "./liveSyntaxFacts";

// Immutable CodeMirror documents share one analysis across editor consumers.
// Weak keys allow replaced documents to be collected with their editor history.
const cache = new WeakMap<Text, MarkdownFacts>();
const liveCache = new WeakMap<EditorState, MarkdownFacts>();
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
  return liveEditorFacts(state).analysis;
}
export function liveEditorFacts(state: EditorState) {
  const provisional = state.field(liveFacts, false);
  if (!provisional) return editorFacts(state.doc);
  let facts = liveCache.get(state);
  if (!facts) {
    facts = validateLiveFacts(state, provisional);
    liveCache.set(state, facts);
  }
  return facts;
}
