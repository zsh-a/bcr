import { useEffect, useId, useRef, useState } from "react";
import { IconButton, SectionLabel } from "@bcr/react";
import { Search, X } from "lucide-react";
import type { KnowledgeNote } from "./model";
import { searchKnowledge, noteSearchHit } from "./retrieval";

export interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  disabled?: boolean;
  run: () => void | Promise<void>;
}

type Row =
  | { kind: "note"; note: KnowledgeNote }
  | { kind: "create"; title: string }
  | { kind: "action"; action: PaletteAction };

/**
 * 命令面板：笔记搜索（打开 / 按标题创建）与操作入口。
 *
 * 常驻挂载：关闭时对话框留在 DOM 中跑完退场动画；每次打开重置查询与选择。
 */
export function NoteSwitcher({
  open,
  notes,
  initialQuery,
  onSelect,
  onCreate,
  onClose,
  actions = [],
}: {
  open: boolean;
  notes: readonly KnowledgeNote[];
  initialQuery: string;
  onSelect: (id: string) => Promise<void>;
  onCreate: (title: string) => Promise<void>;
  onClose: () => void;
  actions?: readonly PaletteAction[];
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    input = useRef<HTMLInputElement>(null);
  const restore = useRef<HTMLElement | null>(null);
  const title = useId();
  const list = useId();
  const [query, setQuery] = useState(""),
    [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const keyword = query.trim().toLowerCase();
  const hits = searchKnowledge(notes, query, { limit: 30 }).hits.map(({ note }) => note);
  const shownActions = actions.filter(
    (action) => !action.disabled && (!keyword || action.label.toLowerCase().includes(keyword)),
  );
  const rows: Row[] = [
    ...hits.map((note) => ({ kind: "note", note }) as Row),
    ...(query.trim() ? [{ kind: "create", title: query.trim() } as Row] : []),
    ...shownActions.map((action) => ({ kind: "action", action }) as Row),
  ];
  const noteRows = hits.length + (query.trim() ? 1 : 0);
  useEffect(() => {
    document.getElementById(`${list}-${selected}`)?.scrollIntoView({ block: "nearest" });
  }, [selected, list]);
  useEffect(() => {
    const element = dialog.current!;
    if (open) {
      restore.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setQuery(initialQuery);
      setSelected(0);
      setError("");
      setBusy(false);
      element.showModal();
      input.current?.focus();
    } else if (element.open) {
      element.close();
      if (restore.current?.isConnected) restore.current.focus();
    }
    // 只随开关切换重置；initialQuery 是打开瞬间的种子。
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 见上注。
  }, [open]);
  async function run(action: () => void | Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
      onClose();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }
  const openRow = (row: Row | undefined) => {
    if (!row) return;
    if (row.kind === "note") void run(() => onSelect(row.note.id));
    else if (row.kind === "create") void run(() => onCreate(row.title));
    else void run(() => row.action.run());
  };
  return (
    <dialog
      ref={dialog}
      className="ui-dialog knowledge-switcher"
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header>
        <h2 id={title} className="ui-dialog-title">
          命令面板
        </h2>
        <IconButton label="关闭命令面板" size="sm" disabled={busy} onClick={onClose}>
          <X size={18} />
        </IconButton>
      </header>
      <div className="knowledge-switcher-search">
        <Search size={18} aria-hidden="true" />
        <input
          ref={input}
          aria-label="搜索笔记或操作"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls={list}
          aria-activedescendant={rows[selected] ? `${list}-${selected}` : undefined}
          placeholder="搜索笔记或操作…"
          value={query}
          disabled={busy}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelected(0);
            setError("");
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setSelected((value) =>
                Math.max(
                  0,
                  Math.min(rows.length - 1, value + (event.key === "ArrowDown" ? 1 : -1)),
                ),
              );
            }
            if (event.key === "Enter") {
              event.preventDefault();
              openRow(rows[selected]);
            }
          }}
        />
      </div>
      <div id={list} role="listbox" className="knowledge-switcher-results" aria-label="搜索结果">
        <div className="knowledge-switcher-group">
          <SectionLabel>笔记</SectionLabel>
          {rows.slice(0, noteRows).map((row, index) => (
            <button
              type="button"
              role="option"
              id={`${list}-${index}`}
              aria-selected={selected === index}
              key={row.kind === "note" ? row.note.id : "create"}
              disabled={busy}
              className={selected === index ? "selected" : ""}
              onFocus={() => setSelected(index)}
              onClick={() => openRow(row)}
            >
              {row.kind === "note" ? (
                <>
                  <strong>{row.note.title || "未命名笔记"}</strong>
                  <span>{noteSearchHit(row.note, query).preview.slice(0, 140)}</span>
                  {row.note.path && !row.note.path.includes(row.note.id) && (
                    <small>{row.note.path}</small>
                  )}
                </>
              ) : row.kind === "create" ? (
                <>
                  <strong>创建「{row.title.slice(0, 30)}」</strong>
                  <span>用这个标题新建一篇笔记</span>
                </>
              ) : null}
            </button>
          ))}
          {!noteRows && <p>没有匹配的笔记。</p>}
        </div>
        {shownActions.length > 0 && (
          <div className="knowledge-switcher-group">
            <SectionLabel>操作</SectionLabel>
            {rows.slice(noteRows).map((row, index) => {
              const at = noteRows + index;
              const action = (row as { action: PaletteAction }).action;
              return (
                <button
                  type="button"
                  role="option"
                  id={`${list}-${at}`}
                  aria-selected={selected === at}
                  key={action.id}
                  disabled={busy}
                  className={selected === at ? "selected" : ""}
                  onFocus={() => setSelected(at)}
                  onClick={() => openRow(row)}
                >
                  <strong>{action.label}</strong>
                  {action.hint && <small>{action.hint}</small>}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      <footer>
        <span role="status">{busy ? "正在处理…" : "↑↓ 选择 · Enter 打开 · Esc 关闭"}</span>
      </footer>
    </dialog>
  );
}
