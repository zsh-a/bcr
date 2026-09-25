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
import { editorAnalysis } from "./editorAnalysis";

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

/** 实时预览里退场的语法标记：括号、围栏、强调符、引用符（光标进入时恢复可编辑）。 */
const QUIET_MARKS = /^(?:HeaderMark|EmphasisMark|CodeMark|StrikethroughMark|QuoteMark)$/u;
/** 链接括号与目标：只在链接/图片内部退场（定义、自动链接保留原文）。 */
const LINK_MARKS = /^(?:LinkMark|URL|LinkTitle)$/u;

/** Presentation only: never rewrites Markdown, selection, or the undo history. */
export function livePreview(open: (target: string) => void) {
  function decorate(view: EditorView) {
    const ranges: Range<Decoration>[] = [];
    const lineClasses = new Map<number, string>();
    const editing = (from: number, to: number) =>
      view.hasFocus &&
      view.state.selection.ranges.some((range) => range.from <= to && range.to >= from);
    const tree = syntaxTree(view.state);
    const analysis = editorAnalysis(view.state);
    // [[wiki]] 整段由按钮部件接管，段内任何标记都不能与之重叠。
    const wiki = analysis.links.filter((link) => link.kind === "wiki");
    for (const visible of view.visibleRanges) {
      tree.iterate({
        from: visible.from,
        to: visible.to,
        enter(node) {
          if (
            node.name === "Blockquote" ||
            node.name === "FencedCode" ||
            node.name === "CodeBlock"
          ) {
            const quote = node.name === "Blockquote";
            const kind = quote ? "knowledge-live-quote" : "knowledge-live-code";
            const firstLineFrom = view.state.doc.lineAt(node.from).from;
            for (let pos = node.from; ;) {
              const line = view.state.doc.lineAt(pos);
              const start = !quote && line.from === firstLineFrom;
              const end = !quote && line.to >= node.to;
              lineClasses.set(
                line.from,
                `${kind}${start ? ` ${kind}-start` : ""}${end ? ` ${kind}-end` : ""}`,
              );
              if (line.to >= node.to || line.to >= view.state.doc.length) break;
              pos = line.to + 1;
            }
            return false;
          }
          if (!QUIET_MARKS.test(node.name)) {
            const parent = node.node.parent;
            if (!LINK_MARKS.test(node.name) || !parent || !/^(?:Link|Image)$/u.test(parent.name))
              return;
            if (wiki.some((link) => node.from < link.to && node.to > link.from)) return;
            if (editing(parent.from, parent.to)) return;
            ranges.push(Decoration.replace({}).range(node.from, node.to));
            return;
          }
          const parent = node.node.parent;
          if (!parent || editing(parent.from, parent.to)) return;
          if (wiki.some((link) => node.from < link.to && node.to > link.from)) return;
          const end =
            node.name === "HeaderMark" && view.state.sliceDoc(node.to, node.to + 1) === " "
              ? node.to + 1
              : node.to;
          ranges.push(Decoration.replace({}).range(node.from, end));
        },
      });
      for (const link of wiki) {
        const start = link.from,
          end = link.to;
        if (start < visible.from || end > visible.to || editing(start, end)) continue;
        if (ranges.some((range) => range.from < end && range.to > start)) continue;
        ranges.push(
          Decoration.replace({
            widget: new WikiLinkWidget(link.label, link.target, open),
          }).range(start, end),
        );
      }
    }
    for (const [from, className] of lineClasses)
      ranges.push(Decoration.line({ class: className }).range(from));
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
