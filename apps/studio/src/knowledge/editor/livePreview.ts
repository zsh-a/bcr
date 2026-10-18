import { syntaxTree } from "@codemirror/language";
import type { Range } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { planLiveMarks, type LiveMark } from "./livePreviewPlan";
import { liveComposition } from "./liveSelection";
import { CodeToolsWidget } from "./CodeToolsWidget";
export { planLiveMarks, listDepth, type LiveMark } from "./livePreviewPlan";
import { createNoteResolver } from "../notes/markdownAnalysis";
import type { KnowledgeNote } from "../session/model";
import { notePath } from "../notes/paths";

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
  constructor(
    private checked: boolean,
    private marker: number,
  ) {
    super();
  }
  eq(other: TaskWidget) {
    return other.checked === this.checked && other.marker === this.marker;
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
      // 唯一的文本写入：仅由用户点击显式触发，翻转 [ ] ↔ [x]。
      const at = pos + this.marker;
      if (!/^\[[ xX]\]$/u.test(view.state.sliceDoc(at - 1, at + 2))) return;
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
    private from: number,
  ) {
    super();
  }
  eq(other: WikiLinkWidget) {
    return (
      other.label === this.label &&
      other.target === this.target &&
      other.tip.main === this.tip.main &&
      other.tip.detail === this.tip.detail &&
      other.open === this.open &&
      other.from === this.from
    );
  }
  toDOM() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "knowledge-inline-link";
    button.dataset.editorFrom = String(this.from);
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
  readOnly: boolean,
) {
  const ranges: Range<Decoration>[] = [];
  for (const mark of marks) {
    switch (mark.kind) {
      case "code-tools":
        ranges.push(
          Decoration.widget({
            widget: new CodeToolsWidget(mark.language, readOnly),
            side: 1,
          }).range(mark.from),
        );
        break;
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
          Decoration.replace({ widget: new TaskWidget(mark.checked, mark.marker) }).range(
            mark.from,
            mark.to,
          ),
        );
        break;
      case "chip":
        ranges.push(
          Decoration.replace({
            widget: new WikiLinkWidget(
              mark.label,
              mark.target,
              tipOf(mark.target),
              open,
              mark.from,
            ),
          }).range(mark.from, mark.to),
        );
        break;
      case "link-chip": {
        const tip = tipOf(mark.target);
        ranges.push(
          Decoration.mark({
            class: "knowledge-inline-chip",
            attributes: {
              "data-link-target": mark.target,
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
    return toDecorations(
      planLiveMarks(view.state, view.hasFocus, view.visibleRanges),
      tipOf,
      open,
      view.state.readOnly,
    );
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
          if (update.docChanged)
            update.view.dom.querySelectorAll(".knowledge-code-status").forEach((status) => {
              status.textContent = "";
            });
          if (
            update.state.field(liveComposition, false) ||
            update.view.compositionStarted ||
            update.transactions.some((tr) => tr.isUserEvent("input.type.compose"))
          ) {
            this.decorations = this.decorations.map(update.changes);
            return;
          }
          if (
            update.startState.field(liveComposition, false) !==
              update.state.field(liveComposition, false) ||
            update.docChanged ||
            update.selectionSet ||
            update.viewportChanged ||
            update.focusChanged ||
            update.startState.readOnly !== update.state.readOnly ||
            syntaxTree(update.startState) !== syntaxTree(update.state)
          )
            this.decorations = decorate(update.view);
        }
      },
      { decorations: (value) => value.decorations },
    ),
  ];
}
