import { syntaxTree } from "@codemirror/language";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import type { Range } from "@codemirror/state";

class WikiLinkWidget extends WidgetType {
  constructor(
    private label: string,
    private target: string,
    private open: (target: string) => void,
  ) {
    super();
  }
  eq(other: WikiLinkWidget) {
    return this.label === other.label && this.target === other.target && this.open === other.open;
  }
  toDOM() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "knowledge-inline-link";
    button.textContent = this.label;
    button.title = "打开关联笔记；切换源码模式可编辑链接";
    button.addEventListener("click", () => this.open(this.target));
    return button;
  }
  ignoreEvent() {
    return true;
  }
}

/** Presentation only: never rewrites Markdown, selection, or the undo history. */
export function livePreview(open: (target: string) => void) {
  function decorate(view: EditorView) {
    const ranges: Range<Decoration>[] = [];
    const editing = (from: number, to: number) =>
      view.hasFocus &&
      view.state.selection.ranges.some((range) => range.from <= to && range.to >= from);
    const tree = syntaxTree(view.state);
    for (const visible of view.visibleRanges) {
      tree.iterate({
        from: visible.from,
        to: visible.to,
        enter(node) {
          if (!/^(?:HeaderMark|EmphasisMark|CodeMark|StrikethroughMark)$/u.test(node.name)) return;
          const parent = node.node.parent;
          if (!parent || editing(parent.from, parent.to)) return;
          const end =
            node.name === "HeaderMark" && view.state.sliceDoc(node.to, node.to + 1) === " "
              ? node.to + 1
              : node.to;
          ranges.push(Decoration.replace({}).range(node.from, end));
        },
      });
      const from = view.state.doc.lineAt(visible.from).from;
      const text = view.state.sliceDoc(from, visible.to);
      for (const match of text.matchAll(/\[\[([^\]\n|[]+)(?:\|([^\]\n]*))?\]\]/gu)) {
        const start = from + match.index,
          end = start + match[0].length;
        if (editing(start, end) || text[match.index - 1] === "\\" || text[match.index - 1] === "!")
          continue;
        let blocked = false;
        for (let node = tree.resolveInner(start + 2, 1); node; node = node.parent!) {
          if (
            /Code|HTML|Image/u.test(node.name) ||
            (/Link/u.test(node.name) && (node.from < start || node.to > end))
          ) {
            blocked = true;
            break;
          }
        }
        if (blocked || ranges.some((range) => range.from < end && range.to > start)) continue;
        ranges.push(
          Decoration.replace({
            widget: new WikiLinkWidget(match[2] || match[1]!, match[1]!, open),
          }).range(start, end),
        );
      }
    }
    return Decoration.set(ranges, true);
  }
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = decorate(view);
      }
      update(update: ViewUpdate) {
        if (
          update.docChanged ||
          update.selectionSet ||
          update.viewportChanged ||
          update.focusChanged ||
          syntaxTree(update.startState) !== syntaxTree(update.state)
        )
          this.decorations = decorate(update.view);
      }
    },
    { decorations: (value) => value.decorations },
  );
}
