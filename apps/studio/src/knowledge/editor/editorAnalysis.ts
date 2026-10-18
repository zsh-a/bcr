import type { EditorState, Text } from "@codemirror/state";
import { analyzeMarkdown, type NoteAnalysis } from "../notes/markdownAnalysis";
import { attachmentReferences, type AttachmentReference } from "../attachments/attachmentModel";

// Immutable CodeMirror documents share one analysis across editor consumers.
// Weak keys allow replaced documents to be collected with their editor history.
const cache = new WeakMap<Text, NoteAnalysis>();
const attachmentCache = new WeakMap<Text, AttachmentReference[]>();
export function editorAttachments(doc: Text) {
  let refs = attachmentCache.get(doc);
  if (!refs) {
    refs = attachmentReferences(doc.toString());
    attachmentCache.set(doc, refs);
  }
  return refs;
}
export function editorAnalysis(state: EditorState): NoteAnalysis {
  let analysis = cache.get(state.doc);
  if (!analysis) {
    analysis = analyzeMarkdown(state.doc.toString());
    cache.set(state.doc, analysis);
  }
  return analysis;
}
