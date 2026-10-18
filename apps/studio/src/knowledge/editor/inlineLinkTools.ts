import { ViewPlugin } from "@codemirror/view";
import { liveComposition } from "./liveSelection";
import { editorLinkAt, type EditorTarget } from "./editorContext";

/** Capture before selection reveal changes the link's geometry. */
export function inlineLinkTools(
  enabled: () => boolean,
  open: (target: EditorTarget) => void,
  close: () => void,
) {
  return ViewPlugin.define((view) => {
    let pending: {
      doc: typeof view.state.doc;
      pos: number;
      link: NonNullable<EditorTarget["link"]>;
    } | null = null;
    const mouse = (event: MouseEvent) => {
      pending = null;
      if (
        !enabled() ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        view.compositionStarted ||
        view.state.field(liveComposition, false) ||
        !(event.target instanceof Element)
      )
        return;
      const chip = event.target.closest(".knowledge-inline-chip");
      if (!chip) return;
      const pos = view.posAtDOM(chip),
        link = editorLinkAt(view.state, pos);
      if (link && link.kind === "markdown") pending = { doc: view.state.doc, pos, link };
    };
    const click = (event: MouseEvent) => {
      const current = pending;
      pending = null;
      if (
        !current ||
        current.doc !== view.state.doc ||
        event.detail > 1 ||
        !view.state.selection.main.empty ||
        event.ctrlKey ||
        event.metaKey ||
        !enabled()
      )
        return;
      const { from, to } = view.state.selection.main;
      open({
        view,
        doc: view.state.doc,
        from,
        to,
        pos: current.pos,
        link: current.link,
        x: event.clientX,
        y: event.clientY + 12,
      });
    };
    const keyboard = (event: KeyboardEvent) => {
      if (
        !enabled() ||
        event.key !== "Enter" ||
        !event.altKey ||
        event.isComposing ||
        view.compositionStarted
      )
        return;
      const pos = view.state.selection.main.head,
        link = editorLinkAt(view.state, pos);
      if (!link || link.kind !== "markdown") return;
      const coords = view.coordsAtPos(pos),
        { from, to } = view.state.selection.main;
      if (coords) {
        event.preventDefault();
        open({
          view,
          doc: view.state.doc,
          from,
          to,
          pos,
          link,
          x: coords.left,
          y: coords.bottom + 8,
          keyboard: true,
        });
      }
    };
    view.dom.addEventListener("mousedown", mouse, true);
    view.dom.addEventListener("click", click);
    view.dom.addEventListener("keydown", keyboard, true);
    return {
      update(update) {
        if (
          update.docChanged ||
          update.selectionSet ||
          update.startState.readOnly !== update.state.readOnly ||
          update.state.field(liveComposition, false)
        )
          close();
      },
      destroy() {
        view.dom.removeEventListener("mousedown", mouse, true);
        view.dom.removeEventListener("click", click);
        view.dom.removeEventListener("keydown", keyboard, true);
      },
    };
  });
}
