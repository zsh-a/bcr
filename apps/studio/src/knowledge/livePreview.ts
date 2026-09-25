import { syntaxTree } from "@codemirror/language";
import type { EditorState, Range, Text } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { editorAnalysis } from "./editorAnalysis";
import { createNoteResolver } from "./markdownAnalysis";
import type { KnowledgeNote } from "./model";
import { notePath } from "./paths";

/** 悬浮小层的两行内容：解析后的目标 + 原始目标（找不到时整体退化为原文）。 */
export interface LinkTip {
  main: string;
  detail?: string;
}

/**
 * 解析链接目标用于 hover 浮层：命中笔记显示标题（无标题退化为路径），
 * 找不到或解析异常一律回退原文，绝不抛错。
 */
export function linkTip(
  resolve: (target: string) => readonly KnowledgeNote[],
  target: string,
): LinkTip {
  try {
    const [hit] = resolve(target);
    if (hit) {
      const display = hit.title.trim() || notePath(hit);
      return display && display !== target ? { main: display, detail: target } : { main: target };
    }
  } catch {
    /* 解析失败不得抛错 */
  }
  return { main: target };
}

/** 装饰意图：纯数据，便于在无 DOM 的环境里断言；不接触文档文本。 */
export type LiveMark =
  | { kind: "hide"; from: number; to: number }
  | { kind: "bullet"; from: number; to: number; depth: number }
  | { kind: "ordinal"; from: number; to: number }
  | { kind: "task"; from: number; to: number; checked: boolean }
  | { kind: "chip"; from: number; to: number; label: string; target: string }
  | { kind: "link-chip"; from: number; to: number; target: string }
  | { kind: "code"; from: number; to: number }
  | { kind: "line"; from: number; class: string };

/** 光标/选区触达的行保持原始标记（含跨行选区），其余行退场渲染。 */
export function revealedLines(doc: Text, ranges: readonly { from: number; to: number }[]) {
  const lines = new Set<number>();
  for (const range of ranges) {
    const first = doc.lineAt(range.from).number;
    const last = doc.lineAt(range.to).number;
    for (let number = first; number <= last; number++) lines.add(number);
  }
  return lines;
}

/** 缩进层级：2/4 空格映射层级 1/2，制表符按 2 空格折算。 */
export function listDepth(line: string, markFrom: number) {
  const indent = line.slice(0, markFrom).replace(/\t/gu, "  ");
  return Math.floor(indent.length / 2);
}

/** 实时预览里退场的语法标记：括号、围栏、强调符、引用符（光标所在行恢复原文）。 */
const QUIET_MARKS = /^(?:HeaderMark|EmphasisMark|CodeMark|StrikethroughMark|QuoteMark)$/u;
/** 链接括号、目标与引用尾标：只在链接/图片内部退场（定义、自动链接保留原文）。 */
const LINK_MARKS = /^(?:LinkMark|LinkLabel|URL|LinkTitle)$/u;

/**
 * Presentation only: never rewrites Markdown, selection, or the undo history.
 * Computes decoration intents for the document state. `focused` enables
 * cursor-line reveal; `ranges` bounds the work to what is on screen.
 */
export function planLiveMarks(
  state: EditorState,
  focused: boolean,
  ranges?: readonly { from: number; to: number }[],
): LiveMark[] {
  const doc = state.doc;
  const marks: LiveMark[] = [];
  const analysis = editorAnalysis(state);
  // [[wiki]] 整段由按钮部件接管，段内任何标记都不能与之重叠。
  const wiki = analysis.links.filter((link) => link.kind === "wiki");
  const inWiki = (from: number, to: number) =>
    wiki.some((link) => from < link.to && to > link.from);
  const reveal = focused ? revealedLines(doc, state.selection.ranges) : new Set<number>();
  const raw = (from: number, to: number) => {
    for (let number = doc.lineAt(from).number; number <= doc.lineAt(to).number; number++)
      if (reveal.has(number)) return true;
    return false;
  };
  const tree = syntaxTree(state);
  tree.iterate({
    ...(ranges && ranges.length ? { from: ranges[0]!.from, to: ranges.at(-1)!.to } : {}),
    enter(node) {
      if (node.name === "Blockquote" || node.name === "FencedCode" || node.name === "CodeBlock") {
        const quote = node.name === "Blockquote";
        const kind = quote ? "knowledge-live-quote" : "knowledge-live-code";
        const firstLineFrom = doc.lineAt(node.from).from;
        for (let pos = node.from; ;) {
          const line = doc.lineAt(pos);
          const start = !quote && line.from === firstLineFrom;
          const end = !quote && line.to >= node.to;
          marks.push({
            kind: "line",
            from: line.from,
            class: `${kind}${start ? ` ${kind}-start` : ""}${end ? ` ${kind}-end` : ""}`,
          });
          if (line.to >= node.to || line.to >= doc.length) break;
          pos = line.to + 1;
        }
        return false;
      }
      if (node.name === "ListItem") {
        const item = node.node;
        const mark = item.firstChild;
        if (!mark || mark.name !== "ListMark" || raw(mark.from, mark.to)) return;
        const next = mark.nextSibling;
        const task = next && next.name === "Task" ? next.firstChild : null;
        if (task && task.name === "TaskMarker") {
          marks.push({
            kind: "task",
            from: mark.from,
            to: task.to,
            checked: /\[[xX]\]/u.test(doc.sliceString(task.from, task.to)),
          });
        } else if (item.parent?.name === "OrderedList") {
          marks.push({ kind: "ordinal", from: mark.from, to: mark.to });
        } else {
          const line = doc.lineAt(mark.from);
          marks.push({
            kind: "bullet",
            from: mark.from,
            to: mark.to,
            depth: listDepth(line.text, mark.from - line.from),
          });
        }
        return; // 嵌套列表继续下降，各自按自己的行判定。
      }
      if (node.name === "Link") {
        const link = node.node;
        // chip 是纯呈现层的稳定包裹（不隐藏文本）：光标行也保留，
        // 否则按下鼠标的瞬间元素被重建，click 事件丢失（Ctrl+点击跳转失效）。
        if (inWiki(link.from, link.to)) return;
        let open = null,
          close = null,
          url = null;
        for (let child = link.firstChild; child; child = child.nextSibling) {
          if (child.name === "URL") {
            url = child;
            continue;
          }
          if (child.name !== "LinkMark") continue;
          if (!open) open = child;
          else if (!close) close = child;
        }
        if (!open || !close || close.from <= open.to) return;
        const target = url
          ? doc.sliceString(url.from, url.to).replace(/^<|>$/gu, "")
          : (analysis.links.find((item) => item.from === link.from)?.target ?? "");
        if (target) marks.push({ kind: "link-chip", from: open.to, to: close.from, target });
        return;
      }
      if (node.name === "InlineCode") {
        if (inWiki(node.from, node.to)) return;
        marks.push({ kind: "code", from: node.from, to: node.to });
        return;
      }
      if (!QUIET_MARKS.test(node.name)) {
        const parent = node.node.parent;
        if (!LINK_MARKS.test(node.name) || !parent || !/^(?:Link|Image)$/u.test(parent.name))
          return;
        if (inWiki(node.from, node.to) || raw(node.from, node.to)) return;
        marks.push({ kind: "hide", from: node.from, to: node.to });
        return;
      }
      if (raw(node.from, node.to) || inWiki(node.from, node.to)) return;
      const end =
        node.name === "HeaderMark" && doc.sliceString(node.to, node.to + 1) === " "
          ? node.to + 1
          : node.to;
      marks.push({ kind: "hide", from: node.from, to: end });
    },
  });
  // 整链替换排在树遍历之后：wiki 部件优先于段内标记；跨可视区边界的整链不渲染。
  for (const link of wiki) {
    if (raw(link.from, link.to)) continue;
    if (ranges && !ranges.some((range) => link.from >= range.from && link.to <= range.to)) continue;
    marks.push({
      kind: "chip",
      from: link.from,
      to: link.to,
      label: link.label,
      target: link.target,
    });
  }
  return marks;
}

class BulletWidget extends WidgetType {
  constructor(private depth: number) {
    super();
  }
  eq(other: BulletWidget) {
    return other.depth === this.depth;
  }
  toDOM() {
    const dot = document.createElement("span");
    dot.className = "knowledge-list-bullet";
    dot.dataset.depth = String(this.depth);
    dot.setAttribute("aria-hidden", "true");
    dot.textContent = "•";
    return dot;
  }
  ignoreEvent() {
    return true;
  }
}

class TaskWidget extends WidgetType {
  constructor(private checked: boolean) {
    super();
  }
  eq(other: TaskWidget) {
    return other.checked === this.checked;
  }
  toDOM() {
    const box = document.createElement("button");
    box.type = "button";
    box.className = "knowledge-task-box";
    box.setAttribute("role", "checkbox");
    box.setAttribute("aria-checked", String(this.checked));
    box.setAttribute("aria-label", "任务勾选");
    if (this.checked) box.textContent = "✓";
    box.addEventListener("click", (event) => {
      event.preventDefault();
      const view = EditorView.findFromDOM(box);
      if (!view || view.state.readOnly) return;
      const pos = view.posAtDOM(box);
      if (pos === null) return;
      const line = view.state.doc.lineAt(pos);
      // 唯一的文本写入：仅由用户点击显式触发，翻转 [ ] ↔ [x]。
      const match = /^(\s*(?:[-*+]|\d{1,9}[.)])\s+)\[[ xX]\]/u.exec(line.text);
      if (!match) return;
      const at = line.from + match[1]!.length + 1;
      view.dispatch({
        changes: { from: at, to: at + 1, insert: this.checked ? " " : "x" },
        userEvent: "input",
      });
      view.focus();
    });
    return box;
  }
  ignoreEvent() {
    return true;
  }
}

class WikiLinkWidget extends WidgetType {
  constructor(
    private label: string,
    private target: string,
    private tip: LinkTip,
    private open: (target: string) => void,
  ) {
    super();
  }
  eq(other: WikiLinkWidget) {
    return (
      other.label === this.label &&
      other.target === this.target &&
      other.tip.main === this.tip.main &&
      other.tip.detail === this.tip.detail &&
      other.open === this.open
    );
  }
  toDOM() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "knowledge-inline-link";
    button.textContent = this.label;
    button.setAttribute("aria-label", `打开关联笔记：${this.tip.main}`);
    button.addEventListener("click", () => this.open(this.target));
    button.addEventListener("pointerenter", () => showTip(button, this.tip));
    button.addEventListener("pointerleave", hideTip);
    return button;
  }
  ignoreEvent() {
    return true;
  }
}

/* ---------- hover 小浮层：单例 DOM，解析结果一行 + 原始目标一行 ---------- */

let tipLayer: HTMLElement | null = null;

function hideTip() {
  tipLayer?.remove();
  tipLayer = null;
  window.removeEventListener("scroll", hideTip, true);
}

function showTip(anchor: HTMLElement, tip: LinkTip) {
  if (!tipLayer) {
    tipLayer = document.createElement("div");
    tipLayer.className = "knowledge-link-popover";
  }
  tipLayer.replaceChildren();
  const title = document.createElement("div");
  title.className = "knowledge-link-popover-title";
  title.textContent = tip.main;
  tipLayer.append(title);
  if (tip.detail) {
    const detail = document.createElement("div");
    detail.className = "knowledge-link-popover-detail";
    detail.textContent = tip.detail;
    tipLayer.append(detail);
  }
  document.body.append(tipLayer);
  const rect = anchor.getBoundingClientRect();
  const box = tipLayer.getBoundingClientRect();
  const top = rect.bottom + 6;
  tipLayer.style.top = `${
    top + box.height > window.innerHeight - 6 ? Math.max(6, rect.top - box.height - 6) : top
  }px`;
  tipLayer.style.left = `${Math.max(6, Math.min(rect.left, window.innerWidth - box.width - 6))}px`;
  window.addEventListener("scroll", hideTip, true);
}

/** 行内链接标记（span chip）不带监听器：按 data-tip 委托给编辑器内容区。 */
const chipTips = EditorView.domEventHandlers({
  pointerover(event) {
    const target = event.target;
    if (!(target instanceof Element)) return false;
    const chip = target.closest(".knowledge-inline-chip");
    if (chip instanceof HTMLElement) {
      const main = chip.dataset.tip;
      if (main !== undefined) {
        const detail = chip.dataset.tipDetail;
        showTip(chip, detail === undefined ? { main } : { main, detail });
        return false;
      }
    }
    hideTip();
    return false;
  },
  pointerout() {
    hideTip();
    return false;
  },
});

function toDecorations(
  marks: LiveMark[],
  tipOf: (target: string) => LinkTip,
  open: (target: string) => void,
) {
  const ranges: Range<Decoration>[] = [];
  for (const mark of marks) {
    switch (mark.kind) {
      case "hide":
        ranges.push(Decoration.replace({}).range(mark.from, mark.to));
        break;
      case "bullet":
        ranges.push(
          Decoration.replace({ widget: new BulletWidget(mark.depth) }).range(mark.from, mark.to),
        );
        break;
      case "ordinal":
        ranges.push(Decoration.mark({ class: "knowledge-list-ordinal" }).range(mark.from, mark.to));
        break;
      case "task":
        ranges.push(
          Decoration.replace({ widget: new TaskWidget(mark.checked) }).range(mark.from, mark.to),
        );
        break;
      case "chip":
        ranges.push(
          Decoration.replace({
            widget: new WikiLinkWidget(mark.label, mark.target, tipOf(mark.target), open),
          }).range(mark.from, mark.to),
        );
        break;
      case "link-chip": {
        const tip = tipOf(mark.target);
        ranges.push(
          Decoration.mark({
            class: "knowledge-inline-chip",
            attributes: {
              "data-tip": tip.main,
              ...(tip.detail ? { "data-tip-detail": tip.detail } : {}),
            },
          }).range(mark.from, mark.to),
        );
        break;
      }
      case "code":
        ranges.push(Decoration.mark({ class: "knowledge-inline-code" }).range(mark.from, mark.to));
        break;
      case "line":
        ranges.push(Decoration.line({ class: mark.class }).range(mark.from));
        break;
    }
  }
  return Decoration.set(ranges, true);
}

/** Presentation only: never rewrites Markdown, selection, or the undo history. */
export function livePreview(
  open: (target: string) => void,
  readNotes?: () => readonly KnowledgeNote[],
) {
  let notes: readonly KnowledgeNote[] | null = null;
  let resolve: ((target: string) => readonly KnowledgeNote[]) | null = null;
  const tipOf = (target: string) => {
    const next = readNotes?.() ?? [];
    if (resolve === null || notes !== next) {
      notes = next;
      resolve = createNoteResolver(next);
    }
    return linkTip(resolve, target);
  };
  function decorate(view: EditorView) {
    return toDecorations(planLiveMarks(view.state, view.hasFocus, view.visibleRanges), tipOf, open);
  }
  return [
    chipTips,
    ViewPlugin.fromClass(
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
    ),
  ];
}
