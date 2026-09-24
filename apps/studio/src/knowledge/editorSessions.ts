import { EditorState } from "@codemirror/state";
import { historyField } from "@codemirror/commands";

/** Ephemeral and bounded. Draft persistence still belongs to NoteDraft. */
export class EditorSessions {
  private entries = new Map<string, { state: EditorState; scroll: number }>();
  save(id: string, state: EditorState, scroll: number) {
    this.entries.delete(id);
    this.entries.set(id, { state, scroll });
    while (this.entries.size > 20) this.entries.delete(this.entries.keys().next().value!);
  }
  restore(id: string, body: string, config: Parameters<typeof EditorState.create>[0]) {
    const entry = this.entries.get(id);
    // A remotely replaced document must never inherit an old undo stack.
    if (!entry || entry.state.doc.toString() !== body)
      return { state: EditorState.create(config), scroll: 0 };
    return {
      state: EditorState.fromJSON(entry.state.toJSON({ history: historyField }), config, {
        history: historyField,
      }),
      scroll: entry.scroll,
    };
  }
  delete(id: string) {
    this.entries.delete(id);
  }
}
