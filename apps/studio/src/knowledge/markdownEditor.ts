import { markdown, markdownLanguage, markdownKeymap } from "@codemirror/lang-markdown";
import { search, searchKeymap } from "@codemirror/search";
import { HighlightStyle, syntaxHighlighting, type LanguageSupport } from "@codemirror/language";
import { EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  ViewPlugin,
  drawSelection,
  highlightActiveLine,
  highlightSpecialChars,
  keymap,
  type ViewUpdate,
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
      backgroundColor: "color-mix(in srgb, var(--color-selection) 50%, transparent)",
    },
    ".cm-activeLine": {
      backgroundColor: "color-mix(in srgb, var(--color-selection) 45%, transparent)",
    },
    ".cm-selectionMatch": {
      backgroundColor: "color-mix(in srgb, var(--color-selection) 50%, transparent)",
    },
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
    /* / 插入面板：图标列 + 单行预览，行距走令牌。 */
    ".cm-tooltip-autocomplete": {
      padding: "var(--space-1)",
      minWidth: "260px",
    },
    ".cm-tooltip-autocomplete > ul > li": {
      display: "flex",
      alignItems: "baseline",
      gap: "var(--space-2)",
      padding: "var(--space-2) var(--space-3)",
      borderRadius: "var(--radius-sm)",
      fontSize: "var(--prose-row)",
      lineHeight: "var(--text-sm--line-height)",
    },
    ".cm-completionIcon": {
      width: "var(--space-6)",
      flexShrink: "0",
      fontFamily: "var(--font-mono)",
      fontSize: "var(--text-xs)",
      color: faint,
    },
    ".cm-completionLabel": {
      color: text,
      fontFamily: "var(--font-sans)",
    },
    ".cm-completionDetail": {
      marginLeft: "auto",
      color: faint,
      fontStyle: "normal",
      fontFamily: "var(--font-mono)",
      fontSize: "var(--text-xs)",
    },
    ".cm-completionMatchedText": {
      textDecoration: "none",
      color: accent,
      fontWeight: "600",
    },
    /* 图标 = 字形标记，保持安静；类型名与 noteEditing 的 type 字段对应。 */
    ".cm-completionIcon-heading1::before": { content: '"H1"' },
    ".cm-completionIcon-heading2::before": { content: '"H2"' },
    ".cm-completionIcon-heading3::before": { content: '"H3"' },
    ".cm-completionIcon-list::before": { content: '"•"' },
    ".cm-completionIcon-task::before": { content: '"☐"' },
    ".cm-completionIcon-quote::before": { content: '"❯"' },
    ".cm-completionIcon-code::before": { content: '"</>"' },
    ".cm-completionIcon-divider::before": { content: '"—"' },
    ".cm-completionIcon-table::before": { content: '"⊞"' },
    ".cm-completionIcon-date::before": { content: '"◷"' },
    ".cm-completionIcon-template::before": { content: '"≡"' },
  },
  { dark: true },
);

/**
 * Markdown 高亮。
 *
 * 标题在源码与实时预览里保持同一层级缩放（H1/H2/H3 = 22/18/16，w500），
 * 永远低于笔记标题的 26px；语法符号（列表符、围栏、链接括号）退到 faint，
 * 不与内容争夺注意力。字号只读知识模块声明的排版变量。
 */
export const knowledgeMarkdownHighlight = HighlightStyle.define(
  [
    { tag: tags.heading1, color: text, fontWeight: "500", fontSize: "var(--prose-h1)" },
    { tag: tags.heading2, color: text, fontWeight: "500", fontSize: "var(--prose-h2)" },
    { tag: tags.heading3, color: text, fontWeight: "500", fontSize: "var(--text-lg)" },
    { tag: tags.heading4, color: text, fontWeight: "500" },
    { tag: tags.heading5, color: text, fontWeight: "500" },
    { tag: tags.heading6, color: text, fontWeight: "500" },
    { tag: tags.strong, color: text, fontWeight: "600" },
    { tag: tags.emphasis, color: text, fontStyle: "italic" },
    { tag: tags.strikethrough, color: faint, textDecoration: "line-through" },
    { tag: tags.link, color: accent },
    { tag: tags.url, color: faint },
    { tag: tags.monospace, color: amber },
    { tag: tags.quote, color: muted, fontStyle: "italic" },
    { tag: tags.list, color: faint },
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
 * 点击正文空白处 = 就近定位光标并聚焦（posAtCoords 兜底到末尾）。
 * 监听挂在 .knowledge-document 祖先上：编辑器外部的页面留白也能落笔，
 * 控件、上下文栏与阅读视图的点击一律不拦截。
 */
function clickToFocus() {
  return ViewPlugin.fromClass(
    class {
      private host: Element | null;
      private readonly onPointerDown = (event: Event) => {
        const view = this.view;
        const mouse = event as MouseEvent;
        if (mouse.button !== 0 || mouse.defaultPrevented || view.dom.offsetParent === null) return;
        const target = mouse.target;
        if (!(target instanceof Element)) return;
        if (
          target.closest(
            ".cm-editor, .knowledge-context, .knowledge-context-inline, .knowledge-prose, button, a, input, select, textarea, summary, label, [contenteditable]",
          )
        )
          return;
        const pos =
          view.posAtCoords({ x: mouse.clientX, y: mouse.clientY }) ?? view.state.doc.length;
        // preventDefault：否则浏览器默认的聚焦目标会把焦点从编辑器拉回 body。
        mouse.preventDefault();
        view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
        view.focus();
      };
      constructor(private view: EditorView) {
        this.host = view.dom.closest(".knowledge-document");
        this.host?.addEventListener("mousedown", this.onPointerDown);
      }
      destroy() {
        this.host?.removeEventListener("mousedown", this.onPointerDown);
      }
    },
  );
}

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
    clickToFocus(),
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

/**
 * 打字机模式：光标移动时把光标行滚动到视区约 60% 高度（scrollIntoView）。
 * 防抖收敛连续按键的滚动；`enabled` 关闭时完全不干预原生滚动。
 */
export function typewriterMode(enabled: () => boolean) {
  return ViewPlugin.fromClass(
    class {
      private timer: number | undefined;
      update(update: ViewUpdate) {
        if (!enabled() || !update.view.hasFocus) return;
        if (!update.selectionSet && !update.docChanged) return;
        if (this.timer !== undefined) window.clearTimeout(this.timer);
        this.timer = window.setTimeout(() => {
          this.timer = undefined;
          const view = update.view;
          if (!view.hasFocus || !enabled()) return;
          view.dispatch({
            effects: EditorView.scrollIntoView(view.state.selection.main.head, {
              y: "start",
              yMargin: view.dom.clientHeight * 0.6,
            }),
          });
        }, 150);
      }
      destroy() {
        if (this.timer !== undefined) window.clearTimeout(this.timer);
      }
    },
  );
}
