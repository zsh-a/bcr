import { markdown, markdownLanguage, markdownKeymap } from "@codemirror/lang-markdown";
import { search, searchKeymap } from "@codemirror/search";
import { HighlightStyle, syntaxHighlighting, type LanguageSupport } from "@codemirror/language";
import { EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightSpecialChars,
  keymap,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { tags } from "@lezer/highlight";

/**
 * Markdown source editing for the knowledge base.
 *
 * The note body is stored and synced as raw Markdown, and the three-way merge
 * in `merge.ts` compares it line by line. So the editor edits the source
 * itself: no document round-trip, no renormalisation, and every keystroke is
 * the exact text that gets saved and merged.
 */

/** Studio design tokens, read through their CSS variables so the shell owns them. */
const color = (name: string, fallback: string) => `var(${name}, ${fallback})`;

const accent = color("--color-accent", "#65d8d0");
const accentDim = color("--color-accent-dim", "#173b39");
const danger = color("--color-danger", "#ff766d");
const warn = color("--color-warn", "#e8c07d");
const ok = color("--color-ok", "#9ad6a0");
const text = color("--color-text", "#f5f5ed");
const muted = color("--color-muted", "#aab2ad");
const faint = color("--color-faint", "#75807b");
const border = color("--color-border", "#343d3a");
const raised = color("--color-raised", "#181d1e");

/**
 * The editor inherits `--font-mono` and the note pane's own `--knowledge-note-*`
 * overrides, so typography stays in CSS next to the rest of the knowledge
 * styles instead of being duplicated here.
 */
export const knowledgeEditorTheme = EditorView.theme(
  {
    "&": {
      color: muted,
      backgroundColor: "transparent",
      height: "100%",
      font: "var(--knowledge-note-font, 14px/1.95 var(--font-mono))",
    },
    ".cm-scroller": {
      font: "inherit",
      padding: "0 4px 20px 0",
      tabSize: "2",
      overflowY: "auto",
    },
    ".cm-content": { caretColor: accent, padding: "0" },
    ".cm-line": { padding: "0" },
    "&.cm-focused": { outline: "none" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: accent, borderLeftWidth: "2px" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
      backgroundColor: accentDim,
    },
    ".cm-activeLine": { backgroundColor: "transparent" },
    ".cm-selectionMatch": { backgroundColor: accentDim },
    ".cm-gutters": { display: "none" },
    ".cm-placeholder": { color: faint },
    ".cm-specialChar": { color: danger },
    ".cm-panels": { backgroundColor: raised, color: text, borderColor: border },
    ".cm-tooltip": { backgroundColor: raised, border: `1px solid ${border}` },
  },
  { dark: true },
);

/**
 * Markdown highlight style.
 *
 * Structural emphasis keeps its weight cue but no added size, so the source
 * reads at the same rhythm as flowing prose. Syntax marks — bullets, fences,
 * link brackets — sit back in a faint tone rather than competing with content.
 */
export const knowledgeMarkdownHighlight = HighlightStyle.define(
  [
    { tag: tags.heading1, color: text, fontWeight: "600", fontSize: "1.45em" },
    { tag: tags.heading2, color: text, fontWeight: "600", fontSize: "1.28em" },
    { tag: tags.heading3, color: text, fontWeight: "600", fontSize: "1.14em" },
    { tag: tags.heading4, color: text, fontWeight: "600" },
    { tag: tags.heading5, color: text, fontWeight: "600" },
    { tag: tags.heading6, color: text, fontWeight: "600" },
    { tag: tags.strong, color: text, fontWeight: "600" },
    { tag: tags.emphasis, color: text, fontStyle: "italic" },
    { tag: tags.strikethrough, color: faint, textDecoration: "line-through" },
    { tag: tags.link, color: accent },
    { tag: tags.url, color: accent },
    { tag: tags.monospace, color: warn },
    { tag: tags.quote, color: muted, fontStyle: "italic" },
    { tag: tags.content, color: muted },
    { tag: tags.contentSeparator, color: faint },
    { tag: tags.labelName, color: faint },
    { tag: tags.string, color: ok },
    { tag: tags.comment, color: faint, fontStyle: "italic" },
    { tag: tags.processingInstruction, color: faint },
    { tag: tags.escape, color: warn },
    { tag: tags.character, color: warn },
  ],
  { themeType: "dark" },
);

/**
 * `markdownLanguage` is already CommonMark plus GFM (tables, task lists,
 * strikethrough, autolink) with subscript/superscript/emoji, which matches what
 * the preview renderer accepts.
 */
export const knowledgeMarkdownLanguage: LanguageSupport = markdown({
  base: markdownLanguage,
});

/**
 * Editor extensions.
 *
 * History is included so Cmd/Ctrl+Z works inside the note, but the authoritative
 * undo boundary is the note itself: the component remounts per note id.
 */
export function knowledgeEditorExtensions(
  onChange: (value: string) => void,
  onSelectionChange?: (ranges: ReadonlyArray<{ from: number; to: number }>) => void,
): Extension[] {
  return [
    knowledgeMarkdownLanguage,
    syntaxHighlighting(knowledgeMarkdownHighlight),
    knowledgeEditorTheme,
    // A note body is one logical document; wrap instead of scrolling sideways.
    EditorView.lineWrapping,
    EditorState.allowMultipleSelections.of(false),
    highlightSpecialChars(),
    drawSelection(),
    highlightActiveLine(),
    history(),
    search({ top: true }),
    keymap.of([
      ...markdownKeymap,
      ...searchKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      indentWithTab,
    ]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) onChange(update.state.doc.toString());
      // Selection is reported so an editor action can address the caret or the
      // selected passage; re-solving it here keeps the range authoritative.
      if (update.selectionSet || update.docChanged)
        onSelectionChange?.(
          update.state.selection.ranges.map((range) => ({ from: range.from, to: range.to })),
        );
    }),
  ];
}
