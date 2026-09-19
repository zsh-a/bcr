import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, placeholder as placeholderExtension } from "@codemirror/view";
import { knowledgeEditorExtensions } from "./markdownEditor";

/**
 * Markdown source editor.
 *
 * React owns the value: `value` is the source of truth and `onChange` reports
 * every edit upward, exactly like the textarea it replaces. The CodeMirror view
 * is built once per note; external changes (draft restore, sync merge) are
 * dispatched into it, so ordinary typing never round-trips through React.
 */
export function MarkdownEditor({
  value,
  onChange,
  label,
  placeholder,
  readOnly = false,
  maxLength,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  readOnly?: boolean;
  /** Mirrors the textarea cap: `decodeNote` rejects longer bodies on save. */
  maxLength?: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // Read the latest callback without rebuilding the view on every render.
  const change = useRef(onChange);
  change.current = onChange;

  useEffect(() => {
    const parent = host.current;
    if (parent === null) return;
    const created = new EditorView({
      parent,
      state: EditorState.create({
        doc: value,
        extensions: [
          ...knowledgeEditorExtensions((next) => change.current(next)),
          EditorView.editable.of(!readOnly),
          EditorState.readOnly.of(readOnly),
          EditorView.contentAttributes.of({ "aria-label": label }),
          ...(placeholder === undefined ? [] : [placeholderExtension(placeholder)]),
          // Refuse edits that would push the body past the persisted limit,
          // matching the textarea's `maxLength` rather than failing on save.
          ...(maxLength === undefined
            ? []
            : [
                EditorState.transactionFilter.of((transaction) =>
                  transaction.newDoc.length > maxLength ? [] : transaction,
                ),
              ]),
        ],
      }),
    });
    view.current = created;
    return () => {
      created.destroy();
      view.current = null;
    };
    // Seeding from `value` is intentional: external updates are handled below,
    // and rebuilding on every keystroke would destroy the user's undo history.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see comment above.
  }, [label, placeholder, readOnly, maxLength]);

  useEffect(() => {
    const current = view.current;
    if (current === null || current.state.doc.toString() === value) return;
    // An external replacement is not a user edit: put the caret at the end
    // rather than restoring an offset that may no longer exist.
    current.dispatch({
      changes: { from: 0, to: current.state.doc.length, insert: value },
      selection: { anchor: value.length },
      scrollIntoView: false,
    });
  }, [value]);

  return <div className="knowledge-body" ref={host} />;
}
