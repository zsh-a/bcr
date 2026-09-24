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

/** 统一令牌经 CSS 变量读取，主题随外壳换肤；色彩只用共享语义名，禁用域内私有色彩名。 */
const color = (name: string) => `var(${name})`;

const accent = color("--color-accent");
const selection = color("--color-selection");
const danger = color("--color-danger");
const amber = color("--color-amber");
const success = color("--color-success");
const text = color("--color-text");
const muted = color("--color-muted");
const faint = color("--color-faint");
const border = color("--color-border");
const raised = color("--color-raised");

/**
 * 编辑器排版由 CSS（.knowledge-body）持有，这里只继承；
 * 编辑器 chrome（光标、选区、活动行、面板、提示层）全部落在共享令牌上。
 */
export const knowledgeEditorTheme = EditorView.theme(
  {
    "&": {
      color: muted,
      backgroundColor: "transparent",
      height: "100%",
      font: "inherit",
    },
    ".cm-scroller": {
      font: "inherit",
      padding: `0 var(--space-1) var(--space-5) 0`,
      tabSize: "2",
      overflowY: "auto",
    },
    ".cm-content": { caretColor: accent, padding: "0" },
    ".cm-line": { padding: "0" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: accent, borderLeftWidth: "2px" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
      backgroundColor: selection,
    },
    ".cm-activeLine": {
      backgroundColor: "color-mix(in srgb, var(--color-raised) 45%, transparent)",
    },
    ".cm-selectionMatch": { backgroundColor: selection },
    /* 写作面保持无栏；行号未启用，槽位直接隐藏。 */
    ".cm-gutters": { display: "none" },
    ".cm-placeholder": { color: faint },
    ".cm-specialChar": { color: danger },
    ".cm-panels": { backgroundColor: raised, color: text, borderColor: border },
    ".cm-tooltip": {
      backgroundColor: raised,
      border: `1px solid ${border}`,
      borderRadius: "var(--radius-sm)",
    },
  },
  { dark: true },
);

/**
 * Markdown 高亮。
 *
 * 结构强调只靠字重，不放大字号，源码与正文保持同一节奏；
 * 语法符号（列表符、围栏、链接括号）退到 faint，不与内容争夺注意力。
 */
export const knowledgeMarkdownHighlight = HighlightStyle.define(
  [
    { tag: tags.heading1, color: text, fontWeight: "600" },
    { tag: tags.heading2, color: text, fontWeight: "600" },
    { tag: tags.heading3, color: text, fontWeight: "600" },
    { tag: tags.heading4, color: text, fontWeight: "600" },
    { tag: tags.heading5, color: text, fontWeight: "600" },
    { tag: tags.heading6, color: text, fontWeight: "600" },
    { tag: tags.strong, color: text, fontWeight: "600" },
    { tag: tags.emphasis, color: text, fontStyle: "italic" },
    { tag: tags.strikethrough, color: faint, textDecoration: "line-through" },
    { tag: tags.link, color: accent },
    { tag: tags.url, color: accent },
    { tag: tags.monospace, color: amber },
    { tag: tags.quote, color: muted, fontStyle: "italic" },
    { tag: tags.content, color: muted },
    { tag: tags.contentSeparator, color: faint },
    { tag: tags.labelName, color: faint },
    { tag: tags.string, color: success },
    { tag: tags.comment, color: faint, fontStyle: "italic" },
    { tag: tags.processingInstruction, color: faint },
    { tag: tags.escape, color: amber },
    { tag: tags.character, color: amber },
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
