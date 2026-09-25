import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { Compartment, EditorState, Transaction } from "@codemirror/state";
import { EditorView, placeholder as placeholderExtension } from "@codemirror/view";
import { knowledgeEditorExtensions, typewriterMode } from "./markdownEditor";
import { EditorSessions } from "./editorSessions";
import { noteEditing, type SlashContext } from "./noteEditing";
import type { KnowledgeNote } from "./model";
import { livePreview } from "./livePreview";

export interface MarkdownEditorHandle {
  reveal(offset: number): void;
  insert(text: string): void;
  /** 聚焦编辑器但不移动光标（模式切换回到编辑时用）。 */
  focus(): void;
}

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
  onSelectionChange,
  sessionId = "note",
  sessions,
  notes = [],
  onOpenLink,
  editorRef,
  live = false,
  typewriter = false,
  slashContext,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  readOnly?: boolean;
  /** Mirrors the textarea cap: `decodeNote` rejects longer bodies on save. */
  maxLength?: number;
  /** Reports the current ranges, so callers can address an edit at the caret or selection. */
  onSelectionChange?: (ranges: ReadonlyArray<{ from: number; to: number }>) => void;
  sessionId?: string;
  sessions?: EditorSessions;
  notes?: readonly KnowledgeNote[];
  onOpenLink?: (target: string) => void;
  editorRef?: Ref<MarkdownEditorHandle>;
  live?: boolean;
  /** 打字机模式：光标行保持在视区约 60% 高度。 */
  typewriter?: boolean;
  /** / 插入面板展开模板变量所需的当前笔记信息。 */
  slashContext?: () => SlashContext;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // Read the latest callback without rebuilding the view on every render.
  const change = useRef(onChange);
  change.current = onChange;
  const selection = useRef(onSelectionChange);
  selection.current = onSelectionChange;
  const latest = useRef({ notes, onOpenLink, slashContext, typewriter });
  latest.current = { notes, onOpenLink, slashContext, typewriter };
  const editability = useRef(new Compartment());
  const presentation = useRef(new Compartment());
  useImperativeHandle(
    editorRef,
    () => ({
      reveal(offset) {
        const current = view.current;
        if (!current) return;
        current.dispatch({
          selection: { anchor: Math.min(Math.max(0, offset), current.state.doc.length) },
          scrollIntoView: true,
        });
        current.focus();
      },
      insert(text) {
        const current = view.current;
        if (!current || current.state.readOnly) return;
        current.dispatch(current.state.replaceSelection(text), {
          scrollIntoView: true,
          userEvent: "input",
        });
        current.focus();
      },
      focus() {
        view.current?.focus();
      },
    }),
    [],
  );

  useEffect(() => {
    const parent = host.current;
    if (parent === null) return;
    const config = {
      doc: value,
      extensions: [
        ...knowledgeEditorExtensions(
          (next) => change.current(next),
          (ranges) => selection.current?.(ranges),
        ),
        ...noteEditing(
          () => latest.current.notes,
          (target) => latest.current.onOpenLink?.(target),
          () => latest.current.slashContext?.() ?? { id: "", title: "" },
        ),
        typewriterMode(() => latest.current.typewriter),
        presentation.current.of(
          live ? livePreview((target) => latest.current.onOpenLink?.(target)) : [],
        ),
        editability.current.of([
          EditorView.editable.of(!readOnly),
          EditorState.readOnly.of(readOnly),
        ]),
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
    };
    const restored = sessions?.restore(sessionId, value, config) ?? {
      state: EditorState.create(config),
      scroll: 0,
    };
    const created = new EditorView({ parent, state: restored.state });
    view.current = created;
    created.requestMeasure({
      read: () => restored.scroll,
      write: (scroll) => {
        created.scrollDOM.scrollTop = scroll;
      },
    });
    selection.current?.(created.state.selection.ranges.map(({ from, to }) => ({ from, to })));
    return () => {
      sessions?.save(sessionId, created.state, created.scrollDOM.scrollTop);
      created.destroy();
      view.current = null;
    };
    // Seeding from `value` is intentional: external updates are handled below,
    // and rebuilding on every keystroke would destroy the user's undo history.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see comment above.
  }, [label, placeholder, maxLength, sessionId, sessions]);

  useEffect(() => {
    view.current?.dispatch({
      effects: editability.current.reconfigure([
        EditorView.editable.of(!readOnly),
        EditorState.readOnly.of(readOnly),
      ]),
    });
  }, [readOnly]);

  useEffect(() => {
    view.current?.dispatch({
      effects: presentation.current.reconfigure(
        live ? livePreview((target) => latest.current.onOpenLink?.(target)) : [],
      ),
    });
  }, [live]);

  useEffect(() => {
    const current = view.current;
    if (current === null || current.state.doc.toString() === value) return;
    // An external replacement is not a user edit: put the caret at the end
    // rather than restoring an offset that may no longer exist.
    current.dispatch({
      changes: { from: 0, to: current.state.doc.length, insert: value },
      selection: { anchor: value.length },
      scrollIntoView: false,
      annotations: Transaction.addToHistory.of(false),
    });
  }, [value]);

  return <div className="knowledge-body" ref={host} />;
}
