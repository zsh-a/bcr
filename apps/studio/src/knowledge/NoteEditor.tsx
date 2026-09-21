import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  useSyncExternalStore,
  type Ref,
} from "react";
import Markdown from "react-markdown";
import { decodeNote, same, type KnowledgeNote, type KnowledgeCollection } from "./model";
import { MarkdownEditor } from "./MarkdownEditor";
import type { KnowledgeStore } from "./store";
import { type EditProposal, type EditTarget, resolve } from "./edit";
import { proposeNoteEdit, type AgentMode } from "./noteAgent";
import {
  agentConfigured,
  agentEndpoint,
  agentSnapshot,
  configureAgent,
  subscribeAgentEndpoint,
} from "./agentSettings";

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
  const [agentText, setAgentText] = useState("");
  const [proposal, setProposal] = useState<EditProposal | null>(null);
  const [asking, setAsking] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const endpoint = useSyncExternalStore(subscribeAgentEndpoint, agentSnapshot);
  const configured = agentConfigured(agentEndpoint());
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

  /**
   * Where an AI edit applies. A selection is authoritative; otherwise the caret.
   * Re-solving against the current draft means a range recorded before further
   * typing cannot address the wrong passage.
   */
  function editTarget(): EditTarget | null {
    const current = state.current.draft.body;
    if (agentTarget === null) return null;
    if (agentTarget.from !== agentTarget.to && agentTarget.to <= current.length)
      return { kind: "selection", from: agentTarget.from, to: agentTarget.to };
    if (agentTarget.from <= current.length) return { kind: "cursor", at: agentTarget.from };
    return null;
  }

  async function ask(mode: AgentMode) {
    const target = editTarget();
    if (!agentText.trim() || target === null || asking) return;
    setAsking(true);
    setError("");
    try {
      setProposal(
        await proposeNoteEdit({
          endpoint: endpoint,
          mode,
          instruction: agentText,
          title: state.current.draft.title,
          body: state.current.draft.body,
          target,
        }),
      );
    } catch (reason) {
      setError(String(reason));
    } finally {
      setAsking(false);
    }
  }

  /**
   * Write an accepted proposal.
   *
   * A stale proposal is dropped rather than applied: the note moved on while the
   * model was running, and the change no longer describes this text.
   */
  function acceptProposal() {
    if (proposal === null) return;
    const next = resolve(proposal, state.current.draft.body);
    setProposal(null);
    if (next === null) {
      setError("正文已变化，这次改动已丢弃（没有写入笔记）");
      return;
    }
    // `change` marks dirty and backs up a draft; the store turns the previous
    // body into a revision on save, so this edit is recoverable from 历史.
    change({ body: next });
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
      <AgentPanel
        configured={configured}
        endpoint={endpoint}
        settingsOpen={settingsOpen}
        setSettingsOpen={setSettingsOpen}
        disabled={locked || !!initial.error}
        asking={asking}
        instruction={agentText}
        setInstruction={setAgentText}
        target={agentTarget}
        proposal={proposal}
        onAsk={ask}
        onAccept={acceptProposal}
        onDiscard={() => setProposal(null)}
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

/**
 * The AI editing affordance.
 *
 * Deliberately an editor control rather than a chat: it transforms the passage
 * the caret is in, and nothing is written until the user accepts it. That
 * preview/accept step is what makes a model's output safe to apply to a note.
 */
function AgentPanel({
  configured,
  endpoint,
  settingsOpen,
  setSettingsOpen,
  disabled,
  asking,
  instruction,
  setInstruction,
  target,
  proposal,
  onAsk,
  onAccept,
  onDiscard,
}: {
  configured: boolean;
  endpoint: { baseUrl: string; apiKey: string; model: string };
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  disabled: boolean;
  asking: boolean;
  instruction: string;
  setInstruction: (value: string) => void;
  target: { from: number; to: number } | null;
  proposal: EditProposal | null;
  onAsk: (mode: AgentMode) => Promise<void>;
  onAccept: () => void;
  onDiscard: () => void;
}) {
  const scope =
    target === null
      ? "正文尚无光标"
      : target.from === target.to
        ? "在光标处插入"
        : `改写选中 ${target.to - target.from} 字符`;
  return (
    <div className="knowledge-agent">
      <div className="knowledge-agent-bar">
        <span className="knowledge-agent-scope" title="编辑范围由正文中的光标或选区决定">
          {scope}
        </span>
        <input
          className="knowledge-agent-instruction"
          aria-label="告诉 AI 如何编辑这段正文"
          placeholder="例如：改写得更简洁，保留结论"
          value={instruction}
          disabled={disabled || asking}
          maxLength={2_000}
          onChange={(event) => setInstruction(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void onAsk("rewrite");
            }
          }}
        />
        <button
          type="button"
          className="knowledge-button"
          disabled={disabled || asking || !instruction.trim() || !configured}
          onClick={() => void onAsk("rewrite")}
        >
          {asking ? "生成中…" : "改写"}
        </button>
        <button
          type="button"
          className="knowledge-button"
          disabled={disabled || asking || !instruction.trim() || !configured}
          onClick={() => void onAsk("continue")}
        >
          续写
        </button>
        <button
          type="button"
          className="knowledge-button"
          aria-label="AI 接口设置"
          aria-pressed={settingsOpen}
          onClick={() => setSettingsOpen(!settingsOpen)}
        >
          接口
        </button>
      </div>
      {settingsOpen && <AgentSettings endpoint={endpoint} />}
      {!configured && !settingsOpen && (
        <p className="knowledge-agent-hint">
          配置 OpenAI 兼容接口后可用；密钥只保存在本页内存，刷新后需重新填写。
        </p>
      )}
      {proposal !== null && (
        <div className="knowledge-agent-preview" role="group" aria-label="待应用的改动">
          <div className="knowledge-agent-preview-head">
            <span>待应用 · {proposal.summary}</span>
            <span>{proposal.changes.length} 处改动</span>
          </div>
          <pre className="knowledge-agent-diff">{changedExcerpt(proposal)}</pre>
          <div className="knowledge-agent-preview-actions">
            <button type="button" className="knowledge-primary" onClick={onAccept}>
              应用到笔记
            </button>
            <button type="button" className="knowledge-button" onClick={onDiscard}>
              放弃
            </button>
            <span className="knowledge-agent-hint">
              应用前的正文会进入「历史」，也可用 Ctrl/⌘+Z 撤销
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/** The affected region with a little context, so the preview shows what actually changes. */
function changedExcerpt(proposal: EditProposal): string {
  const first = proposal.changes[0];
  if (first === undefined) return "(无改动)";
  const context = 60;
  const from = Math.max(0, first.from - context);
  const lead = proposal.base.slice(from, first.from);
  const head = from > 0 ? "…" : "";
  const nextLength = proposal.base.length - (first.to - first.from) + first.insert.length;
  const tail = nextLength > first.from + first.insert.length + context ? "…" : "";
  return [
    `- ${head}${truncate(lead + proposal.base.slice(first.from, first.to), 240)}`,
    `+ ${head}${truncate(lead + first.insert, 240)}${tail}`,
  ].join("\n");
}

const truncate = (value: string, limit: number) =>
  value.length > limit ? `${value.slice(0, limit)}…` : value;

/** Endpoint settings. Memory-only, matching how the GitHub token is handled. */
function AgentSettings({
  endpoint,
}: {
  endpoint: { baseUrl: string; apiKey: string; model: string };
}) {
  const [baseUrl, setBaseUrl] = useState(endpoint.baseUrl);
  const [apiKey, setApiKey] = useState(endpoint.apiKey);
  const [model, setModel] = useState(endpoint.model);
  return (
    <form
      className="knowledge-agent-settings"
      onSubmit={(event) => {
        event.preventDefault();
        configureAgent({ baseUrl, apiKey, model });
      }}
    >
      <label>
        接口地址
        <input
          aria-label="AI 接口地址"
          placeholder="http://127.0.0.1:11434/v1"
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
        />
      </label>
      <label>
        模型
        <input
          aria-label="AI 模型名称"
          placeholder="gpt-4o-mini"
          value={model}
          onChange={(event) => setModel(event.target.value)}
        />
      </label>
      <label>
        密钥
        <input
          aria-label="AI 接口密钥"
          type="password"
          placeholder="本地接口可留空"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
        />
      </label>
      <div>
        <button type="submit" className="knowledge-button">
          保存到本次会话
        </button>
        <button
          type="button"
          className="knowledge-button"
          onClick={() => {
            setBaseUrl("");
            setApiKey("");
            setModel("");
            configureAgent(null);
          }}
        >
          清除
        </button>
      </div>
    </form>
  );
}
