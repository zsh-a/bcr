import { Prec, StateEffect, StateField, type EditorState } from "@codemirror/state";
import { EditorView, ViewPlugin, keymap } from "@codemirror/view";

/** Home reaches the real source prefix even when the visual line starts after a hidden marker. */
export function liveSyntaxNavigation(enabled: () => boolean) {
  const home = (view: EditorView, extend = false) => {
    if (!enabled() || view.compositionStarted) return false;
    const range = view.state.selection.main,
      line = view.state.doc.lineAt(range.head);
    if (!/^[ \t]*(?:#{1,6}\s|>\s?|[-*+] |\d{1,9}[.)] )/u.test(line.text)) return false;
    view.dispatch({
      selection: { anchor: extend ? range.anchor : line.from, head: line.from },
      scrollIntoView: true,
    });
    return true;
  };
  return Prec.high(
    keymap.of([
      { key: "Home", run: (view) => home(view), shift: (view) => home(view, true) },
      { mac: "Mod-ArrowLeft", run: (view) => home(view), shift: (view) => home(view, true) },
    ]),
  );
}

/** Selection ends are exclusive; a caret at a delimiter boundary can edit that delimiter. */
export function touchesSyntax(state: EditorState, from: number, to: number, edge = true) {
  return state.selection.ranges.some((range) =>
    range.empty
      ? range.head >= from && (edge ? range.head <= to : range.head < to)
      : range.from < to && range.to > from,
  );
}

const composing = StateEffect.define<boolean>();
export const liveComposition = StateField.define({
  create: () => false,
  update(value, transaction) {
    if (transaction.isUserEvent("input.type.compose")) value = true;
    for (const effect of transaction.effects) if (effect.is(composing)) value = effect.value;
    return value;
  },
});

/** Keep existing decorations during native IME; the final commit can follow compositionend. */
export function compositionGuard() {
  return [
    liveComposition,
    ViewPlugin.fromClass(
      class {
        private timer: number | undefined;
        private frame: number | undefined;
        constructor(private view: EditorView) {}
        cancel() {
          window.clearTimeout(this.timer);
          if (this.frame !== undefined) cancelAnimationFrame(this.frame);
        }
        settle() {
          this.cancel();
          this.timer = window.setTimeout(() => {
            this.frame = requestAnimationFrame(() => {
              if (this.view.compositionStarted) return this.settle();
              this.view.dispatch({ effects: composing.of(false) });
            });
          }, 80);
        }
        update(update: import("@codemirror/view").ViewUpdate) {
          if (update.transactions.some((tr) => tr.isUserEvent("input.type.compose"))) this.settle();
        }
        destroy() {
          this.cancel();
        }
      },
      {
        eventHandlers: {
          compositionstart(_event, view) {
            this.cancel();
            view.dispatch({ effects: composing.of(true) });
          },
          compositionend() {
            this.settle();
          },
          blur(_event, view) {
            if (view.state.field(liveComposition)) this.settle();
          },
        },
      },
    ),
  ];
}
