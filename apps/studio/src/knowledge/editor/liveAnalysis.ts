import { StateEffect, StateField, type Text, type Transaction } from "@codemirror/state";
import { ViewPlugin, type ViewUpdate } from "@codemirror/view";
import {
  cachedMarkdownFacts,
  emptyMarkdownFacts,
  type MarkdownFacts,
} from "../notes/markdownAnalysis";
import { analyzeMarkdownAsync } from "../notes/markdownAnalysisClient";

export const analyzedDocument = StateEffect.define<{ doc: Text; facts: MarkdownFacts }>();

function mappedFacts(facts: MarkdownFacts, tr: Transaction): MarkdownFacts {
  // Editing a shared definition can change destinations anywhere in the document.
  let definitionChanged = facts.definitionRanges.some((range) =>
    tr.changes.touchesRange(range.from, range.to),
  );
  tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    for (const [doc, from, to] of [
      [tr.startState.doc, fromA, toA],
      [tr.newDoc, fromB, toB],
    ] as const) {
      const a = doc.lineAt(from),
        b = doc.lineAt(to);
      // New definitions may be nested or split across a label/destination line.
      const start = doc.line(Math.max(1, a.number - 1)).from;
      if (doc.sliceString(start, b.to).includes("]:")) definitionChanged = true;
    }
  });
  if (definitionChanged) return emptyMarkdownFacts;
  const map = <T extends { from: number; to: number }>(items: T[]) =>
    items
      .filter((item) => !tr.changes.touchesRange(item.from, item.to))
      .map((item) => ({
        ...item,
        from: tr.changes.mapPos(item.from, 1),
        to: tr.changes.mapPos(item.to, -1),
      }));
  return {
    ...facts,
    analysis: { headings: [], links: map(facts.analysis.links) },
    attachments: map(facts.attachments),
    definitionRanges: map(facts.definitionRanges),
    editorLinks: map(facts.editorLinks),
  };
}

export const liveFacts = StateField.define<MarkdownFacts>({
  create: (state) => cachedMarkdownFacts(state.doc.toString()) ?? emptyMarkdownFacts,
  update(value, tr) {
    let next = tr.docChanged ? mappedFacts(value, tr) : value;
    for (const effect of tr.effects)
      if (effect.is(analyzedDocument) && effect.value.doc === tr.newDoc) next = effect.value.facts;
    return next;
  },
});

export function liveAnalysis() {
  return [
    liveFacts,
    ViewPlugin.fromClass(
      class {
        private controller: AbortController | undefined;
        private timer: ReturnType<typeof setTimeout> | undefined;
        constructor(private view: import("@codemirror/view").EditorView) {
          this.schedule();
        }
        private schedule() {
          clearTimeout(this.timer);
          this.controller?.abort();
          const controller = (this.controller = new AbortController());
          const doc = this.view.state.doc;
          this.timer = setTimeout(() => {
            void analyzeMarkdownAsync(doc.toString(), controller.signal).then(
              (facts) => {
                if (!controller.signal.aborted && this.view.state.doc === doc)
                  this.view.dispatch({ effects: analyzedDocument.of({ doc, facts }) });
              },
              () => {},
            );
          }, 90);
        }
        update(update: ViewUpdate) {
          if (update.docChanged) this.schedule();
        }
        destroy() {
          clearTimeout(this.timer);
          this.controller?.abort();
        }
      },
    ),
  ];
}
