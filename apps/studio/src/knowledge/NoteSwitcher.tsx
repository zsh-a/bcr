import { useEffect, useId, useRef, useState } from "react";
import { Button, IconButton } from "@bcr/react";
import { Search, X, Plus } from "lucide-react";
import type { KnowledgeNote } from "./model";
import { searchKnowledge, noteSearchHit } from "./retrieval";
import { notePath } from "./paths";

/**
 * 快速切换（命令面板）。
 *
 * 常驻挂载：关闭时对话框留在 DOM 中跑完退场动画；每次打开重置查询与选择，
 * 行为与原先的按需挂载一致。
 */
export function NoteSwitcher({
  open,
  notes,
  initialQuery,
  onSelect,
  onCreate,
  onClose,
}: {
  open: boolean;
  notes: readonly KnowledgeNote[];
  initialQuery: string;
  onSelect: (id: string) => Promise<void>;
  onCreate: (title: string) => Promise<void>;
  onClose: () => void;
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
  const hits = searchKnowledge(notes, query, { limit: 30 }).hits;
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
  async function run(action: () => Promise<void>) {
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
          快速打开笔记
        </h2>
        <IconButton label="关闭快速切换" size="sm" disabled={busy} onClick={onClose}>
          <X size={18} />
        </IconButton>
      </header>
      <div className="knowledge-switcher-search">
        <Search size={18} aria-hidden="true" />
        <input
          ref={input}
          aria-label="查找或创建笔记"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls={list}
          aria-activedescendant={hits[selected] ? `${list}-${selected}` : undefined}
          placeholder="搜索标题、路径、标签或正文…"
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
                  Math.min(hits.length - 1, value + (event.key === "ArrowDown" ? 1 : -1)),
                ),
              );
            }
            if (event.key === "Enter") {
              event.preventDefault();
              const hit = hits[selected];
              if (hit) void run(() => onSelect(hit.note.id));
              else if (query.trim()) void run(() => onCreate(query.trim()));
            }
          }}
        />
      </div>
      <div id={list} role="listbox" className="knowledge-switcher-results" aria-label="匹配笔记">
        {hits.map(({ note }, index) => (
          <button
            type="button"
            role="option"
            id={`${list}-${index}`}
            aria-selected={selected === index}
            key={note.id}
            disabled={busy}
            className={selected === index ? "selected" : ""}
            onFocus={() => setSelected(index)}
            onClick={() => void run(() => onSelect(note.id))}
          >
            <strong>{note.title || "未命名笔记"}</strong>
            <span>{noteSearchHit(note, query).preview.slice(0, 140)}</span>
            <small>
              {notePath(note)} · {new Date(note.updatedAt).toLocaleDateString()}
            </small>
          </button>
        ))}
        {!hits.length && <p>没有匹配的笔记，可以直接创建。</p>}
      </div>
      {error && <p role="alert">{error}</p>}
      <footer>
        <span role="status">
          {busy ? "正在打开…" : `${hits.length} 个结果 · ↑↓ 选择 · Enter 打开`}
        </span>
        {query.trim() && (
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => void run(() => onCreate(query.trim()))}
          >
            <Plus size={15} />
            创建「{query.trim().slice(0, 30)}」
          </Button>
        )}
      </footer>
    </dialog>
  );
}
