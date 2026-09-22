import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import Markdown from "react-markdown";
import { useRuntimeActivity, useAgentHost } from "@bcr/react";
import { decodeNote, same, type KnowledgeNote, type KnowledgeCollection } from "./model";
import { MarkdownEditor } from "./MarkdownEditor";
import type { KnowledgeStore } from "./store";

export interface EditorHandle {
  flush(): Promise<void>;
}
const draftKey = (id: string) => `bcr/knowledge-draft/v1/${id}`;
export function NoteEditor({
  note,
  store,
  collections,
  locked,
  editorRef,
}: {
  note: KnowledgeNote;
  store: KnowledgeStore;
  collections: KnowledgeCollection[];
  locked: boolean;
  editorRef: Ref<EditorHandle>;
}) {
  const active = useRuntimeActivity();
  const { activateSurface, registerAgentCapability, registerSurface } = useAgentHost();
  const [initial] = useState(() => {
    try {
      const raw = localStorage.getItem(draftKey(note.id));
      if (raw) {
        const data = JSON.parse(raw),
          draft = decodeNote(data.note),
          base = decodeNote(data.base);
        if (draft.id !== note.id || base.id !== note.id) throw new Error("草稿身份不匹配");
        return { draft, base, dirty: !same(draft, note), error: "" };
      }
      return { draft: note, base: note, dirty: false, error: "" };
    } catch {
      return {
        draft: note,
        base: note,
        dirty: false,
        error: "无法读取本地草稿，请检查浏览器存储并刷新；编辑已暂停",
      };
    }
  });
  const [draft, setDraft] = useState(initial.draft);
  const [tagText, setTagText] = useState(initial.draft.tags.join(", "));
  const [status, setStatus] = useState(initial.dirty ? "已恢复未保存草稿" : "已保存到本机");
  const [error, setError] = useState(initial.error);
  const [preview, setPreview] = useState(false);
  const state = useRef({
    draft: initial.draft,
    base: initial.base,
    dirty: initial.dirty,
    sequence: 0,
  });
  const pending = useRef<Promise<void> | null>(null);
  const live = useRef(true);
  const [agentTarget, setAgentTarget] = useState<{ from: number; to: number } | null>(null);
  const flush = async (): Promise<void> => {
    if (pending.current) await pending.current;
    if (!state.current.dirty) return;
    if (locked) throw new Error("请先解决同步冲突，编辑草稿已保留");
    const captured = { ...state.current };
    const operation = (async () => {
      if (live.current) {
        setStatus("正在保存…");
        setError("");
      }
      await store.saveNote(captured.draft, captured.base);
      if (state.current.sequence === captured.sequence) {
        const saved = store.getSnapshot().notes[note.id] ?? captured.draft;
        state.current = { ...state.current, base: saved, draft: saved, dirty: false };
        try {
          localStorage.removeItem(draftKey(note.id));
        } catch {
          if (live.current) setError("笔记已保存，草稿清理失败；可以继续编辑");
        }
        if (live.current) {
          setDraft(saved);
          setStatus("已保存到本机");
        }
      } else {
        state.current.base = captured.draft;
        try {
          localStorage.setItem(
            draftKey(note.id),
            JSON.stringify({ base: captured.draft, note: state.current.draft }),
          );
        } catch {
          /* The current draft remains in memory and will be saved next. */
        }
      }
    })();
    pending.current = operation;
    try {
      await operation;
    } catch (reason) {
      if (live.current) {
        setError(String(reason));
        setStatus("保存失败 · 草稿保留");
      }
      throw reason;
    } finally {
      if (pending.current === operation) pending.current = null;
    }
    if (state.current.dirty) await flush();
  };
  useImperativeHandle(editorRef, () => ({ flush }));
  /**
   * Publish the note as the agent's target.
   *
   * `read` re-resolves from the live draft so a range recorded before further
   * typing cannot address the wrong passage, and `write` goes through `change`,
   * which keeps the previous body in 历史 via the store.
   */
  useEffect(() => {
    const unregister = registerSurface({
      kind: "knowledge.note",
      capabilityId: "knowledge.note",
      label: draft.title || "未命名笔记",
      read: () => {
        if (locked || initial.error) return null;
        const body = state.current.draft.body;
        const selection =
          agentTarget !== null &&
          agentTarget.from !== agentTarget.to &&
          agentTarget.to <= body.length
            ? agentTarget
            : null;
        const at =
          agentTarget !== null && agentTarget.from <= body.length ? agentTarget.from : body.length;
        const range = selection ?? { from: at, to: at };
        return {
          text: body,
          range: { start: range.from, end: range.to },
          instruction: body.slice(range.from, range.to) || "（光标处）",
          scope: selection === null ? "在光标处插入" : `选中 ${selection.to - selection.from} 字符`,
        };
      },
      write: (next) => change({ body: next }),
    });
    const unregisterCapability = registerAgentCapability({
      id: "knowledge.note",
      label: "知识库笔记",
      description: "读取当前笔记与选区，确认后修改正文",
      domain: "knowledge",
      scope: "workspace",
      available: () => active,
      // Read tools are supplied by the domain; the host owns execution policy.
      tools: [
        {
          spec: {
            name: "read_note",
            description: "Read the open note's current body.",
            input_schema: { type: "object" },
            risk: "read_only",
          },
          call: async () => JSON.stringify({ body: state.current.draft.body }),
        },
        {
          spec: {
            name: "read_selection",
            description: "Read the passage the user has selected in the open note.",
            input_schema: { type: "object" },
            risk: "read_only",
          },
          call: async () =>
            JSON.stringify({
              selection: targetTextNow(state.current.draft.body, agentTarget),
            }),
        },
      ],
    });
    activateSurface(active ? "knowledge.note" : null);
    return () => {
      unregisterCapability();
      unregister();
    };
  }, [
    active,
    agentTarget,
    draft.title,
    locked,
    initial.error,
    activateSurface,
    registerAgentCapability,
    registerSurface,
  ]);
  useEffect(() => {
    if (!state.current.dirty && !pending.current) {
      state.current = { draft: note, base: note, dirty: false, sequence: state.current.sequence };
      setDraft(note);
      setTagText(note.tags.join(", "));
    }
  }, [note]);
  useEffect(() => {
    if (!state.current.dirty || locked) return;
    const timer = setTimeout(() => {
      void flush().catch(() => undefined);
    }, 500);
    return () => clearTimeout(timer);
  }, [draft, locked]);
  useEffect(() => {
    live.current = true;
    const unload = (event: BeforeUnloadEvent) => {
      if (state.current.dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => {
      live.current = false;
      window.removeEventListener("beforeunload", unload);
      void flush().catch(() => undefined);
    };
  }, []);
  function change(patch: Partial<KnowledgeNote>) {
    const next = { ...state.current.draft, ...patch, updatedAt: Date.now() };
    state.current = {
      ...state.current,
      draft: next,
      dirty: true,
      sequence: state.current.sequence + 1,
    };
    try {
      localStorage.setItem(
        draftKey(note.id),
        JSON.stringify({ base: state.current.base, note: next }),
      );
    } catch {
      setError("浏览器草稿备份失败，正在尝试保存笔记；成功前请保持页面打开");
    }
    setDraft(next);
    setStatus("待保存…");
  }

  return (
    <section className="knowledge-editor" aria-label="笔记编辑器">
      <div className="knowledge-editor-meta">
        <select
          aria-label="笔记所属集合"
          value={draft.collectionId ?? ""}
          disabled={locked || !!initial.error}
          onChange={(e) => change({ collectionId: e.target.value || null })}
        >
          <option value="">未归类</option>
          {draft.collectionId && !collections.some((c) => c.id === draft.collectionId) && (
            <option value={draft.collectionId}>集合未同步</option>
          )}
          {collections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <span role="status">{status}</span>
        <button
          type="button"
          className="knowledge-button"
          aria-pressed={preview}
          onClick={() => setPreview(!preview)}
        >
          {preview ? "继续编辑" : "预览"}
        </button>
      </div>
      {error && (
        <div role="alert" className="knowledge-alert">
          {error}
          {!initial.error && (
            <button type="button" onClick={() => void flush().catch(() => undefined)}>
              重试保存
            </button>
          )}
        </div>
      )}
      <input
        className="knowledge-title"
        aria-label="笔记标题"
        placeholder="给这个想法一个名字"
        value={draft.title}
        maxLength={500}
        disabled={locked || !!initial.error}
        onChange={(e) => change({ title: e.target.value })}
      />
      <input
        className="knowledge-tags"
        aria-label="笔记标签"
        placeholder="添加标签，用逗号分隔"
        value={tagText}
        disabled={locked || !!initial.error}
        onChange={(e) => {
          setTagText(e.target.value);
          change({
            tags: e.target.value
              .split(/[,，]/u)
              .map((t) => t.trim())
              .filter(Boolean)
              .slice(0, 100),
          });
        }}
        onBlur={() => setTagText(state.current.draft.tags.join(", "))}
      />
      {preview ? (
        <article className="knowledge-prose">
          <Markdown
            components={{
              img: ({ alt }) => (
                <span className="text-muted">[图片：{alt || "附件"} · 首期不自动加载外部资源]</span>
              ),
              a: ({ children, href }) => (
                <a href={href} target="_blank" rel="noreferrer noopener">
                  {children}
                </a>
              ),
            }}
          >
            {draft.body || "开始记录你的第一个想法。"}
          </Markdown>
        </article>
      ) : (
        <MarkdownEditor
          label="笔记正文"
          placeholder={"从这里开始写。\n\n支持 Markdown，也可以把资料摘录带进来慢慢整理。"}
          value={draft.body}
          readOnly={locked || !!initial.error}
          maxLength={500_000}
          onChange={(body) => change({ body })}
          onSelectionChange={(ranges) => setAgentTarget(ranges[0] ?? null)}
        />
      )}
      <footer className="knowledge-editor-footer">
        <span>MARKDOWN</span>
        <span>{draft.body.length.toLocaleString()} 字符</span>
        <span>本地自动保存</span>
      </footer>
    </section>
  );
}

/** The selected passage, or the caret position when nothing is selected. */
function targetTextNow(body: string, target: { from: number; to: number } | null): string {
  if (target === null) return "";
  const selection = target.from !== target.to && target.to <= body.length ? target : null;
  if (selection !== null) return body.slice(selection.from, selection.to);
  return "";
}
