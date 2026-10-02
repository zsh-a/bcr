import type { EditorState, Text } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { analyzeEditorLinks, internalTarget, type EditorLink } from "./markdownAnalysis";
import { attachmentId } from "./attachmentModel";

const links = new WeakMap<Text, EditorLink[]>();
export function editorLinkAt(state: EditorState, pos: number) {
  let index = links.get(state.doc);
  if (!index) {
    index = analyzeEditorLinks(state.doc.toString());
    links.set(state.doc, index);
  }
  return index.find((link) => pos >= link.from && pos < link.to && !attachmentId(link.url));
}

export interface EditorTarget {
  view: EditorView;
  doc: Text;
  from: number;
  to: number;
  pos: number;
  link?: EditorLink | undefined;
  x: number;
  y: number;
}

/** Async clipboard/dialog actions must never write into a different document or selection. */
export function targetValid(target: EditorTarget, writable = true) {
  const { view, doc, from, to } = target;
  return (
    view.dom.isConnected &&
    view.state.doc === doc &&
    (!writable || !view.state.readOnly) &&
    view.state.selection.main.from === from &&
    view.state.selection.main.to === to
  );
}

export function safeEditorLink(value: string) {
  const url = value.trim();
  if (!url || /\p{Cc}/u.test(url)) return false;
  if (internalTarget(url) !== null) return true;
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" || parsed.protocol === "http:" || parsed.protocol === "mailto:"
    );
  } catch {
    return false;
  }
}

const markdownLabel = (text: string) =>
  text.replace(/[\\`*_[\]<>]/gu, "\\$&").replace(/\r?\n/gu, " ");
const markdownUrl = (url: string) =>
  url.replace(/[\\()<>\s]/gu, (char) =>
    char === "(" ? "%28" : char === ")" ? "%29" : encodeURIComponent(char),
  );

export function editorUnlink(target: EditorTarget) {
  const link = target.link;
  if (!link) return "";
  if (link.reference) return link.reference.label;
  if (link.destination)
    return target.doc.sliceString(
      link.from + 1,
      target.doc.toString().lastIndexOf("](", link.destination.from),
    );
  return markdownLabel(link.label);
}

/** Preserve formatted labels/titles and detach only the clicked reference from its definition. */
export function editorLinkMarkdown(target: EditorTarget, label: string, url: string) {
  const link = target.link,
    source = target.doc.toString();
  if (link?.kind === "wiki" && internalTarget(url) !== null) {
    if (/[[\]|\r\n]/u.test(url + label))
      throw new Error("笔记链接的名称和目标不能包含括号、竖线或换行。");
    return `[[${url}${label && label !== url ? `|${label}` : ""}]]`;
  }
  const sameLabel = link && label === link.label;
  const rawLabel =
    sameLabel && link.kind === "markdown" ? editorUnlink(target) : markdownLabel(label || url);
  if (sameLabel && link?.destination) {
    return (
      source.slice(link.from, link.destination.from) +
      markdownUrl(url) +
      source.slice(link.destination.to, link.to)
    );
  }
  const title = link?.reference?.title;
  return `[${rawLabel}](${markdownUrl(url)}${title ? ` "${title.replace(/[\\"]/gu, "\\$&")}"` : ""})`;
}

export function editorContextMenu(open: (target: EditorTarget) => void, close: () => void) {
  return ViewPlugin.define((view) => {
    let pending: { pos: number; link?: EditorLink | undefined; doc: Text } | null = null;
    const excluded = (event: Event) =>
      event.target instanceof Element &&
      !!event.target.closest(
        ".cm-panels, .cm-tooltip, .knowledge-image-block, .knowledge-attachment-inline",
      );
    const desktop = () => window.matchMedia("(any-pointer: fine)").matches;
    const point = (event: MouseEvent) => {
      const widget =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>("[data-editor-from]")
          : null;
      const pos = widget
        ? Number(widget.dataset.editorFrom)
        : view.posAtCoords({ x: event.clientX, y: event.clientY });
      return pos ?? view.state.selection.main.head;
    };
    const select = (pos: number) => {
      const range = view.state.selection.main;
      if (range.empty || pos < range.from || pos > range.to)
        view.dispatch({ selection: { anchor: pos } });
      view.focus();
    };
    const mouse = (event: MouseEvent) => {
      pending = null;
      if (
        event.button !== 2 ||
        event.shiftKey ||
        excluded(event) ||
        !desktop() ||
        view.compositionStarted
      )
        return;
      const pos = point(event);
      pending = { pos, link: editorLinkAt(view.state, pos), doc: view.state.doc };
      event.preventDefault();
      select(pos);
    };
    const show = (pos: number, x: number, y: number, link = editorLinkAt(view.state, pos)) => {
      const { from, to } = view.state.selection.main;
      open({ view, doc: view.state.doc, from, to, pos, link, x, y });
    };
    const context = (event: MouseEvent) => {
      if (event.shiftKey || excluded(event) || !desktop() || view.compositionStarted) return;
      event.preventDefault();
      event.stopPropagation();
      const previous = pending?.doc === view.state.doc ? pending : null;
      const pos = previous?.pos ?? point(event);
      const link = previous?.link ?? editorLinkAt(view.state, pos);
      select(pos);
      show(pos, event.clientX, event.clientY, link);
      pending = null;
    };
    const key = (event: KeyboardEvent) => {
      if (
        excluded(event) ||
        event.isComposing ||
        view.compositionStarted ||
        !(event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey))
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      const pos = view.state.selection.main.head,
        coords = view.coordsAtPos(pos);
      const rect = view.contentDOM.getBoundingClientRect();
      show(pos, coords?.left ?? rect.left, coords?.bottom ?? rect.top);
    };
    view.dom.addEventListener("mousedown", mouse, true);
    view.dom.addEventListener("contextmenu", context, true);
    view.dom.addEventListener("keydown", key, true);
    return {
      update(update) {
        if (
          update.docChanged ||
          update.selectionSet ||
          update.startState.readOnly !== update.state.readOnly
        )
          close();
      },
      destroy() {
        view.dom.removeEventListener("mousedown", mouse, true);
        view.dom.removeEventListener("contextmenu", context, true);
        view.dom.removeEventListener("keydown", key, true);
      },
    };
  });
}
