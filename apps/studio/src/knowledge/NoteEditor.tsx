import {
  useDeferredValue,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
} from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { type KnowledgeNote, type KnowledgeCollection } from "./model";
import { MarkdownEditor, type MarkdownEditorHandle } from "./MarkdownEditor";
import type { EditorSessions } from "./editorSessions";
import { analyzeMarkdown, internalTarget, remarkKnowledgeLinks, linkKey } from "./markdownAnalysis";
import { NoteContext } from "./NoteContext";
import { fillTemplate } from "./workbench";
import type { KnowledgeStore } from "./store";
import { useNoteDraft } from "./useNoteDraft";
import { useNoteAgent } from "./useNoteAgent";
import type { NoteSelection } from "./editorAgent";
import { NoteRename } from "./NoteRename";
import type { LiveRename } from "./liveRename";
import {
  decodeReadingSettings,
  READING_SETTINGS_KEY,
  type ReadingSettings,
} from "./readingSettings";
import { Button, Select, useUpdateParticipant } from "@bcr/react";

export interface EditorHandle {
  flush(): Promise<void>;
}

type EditorMode = "edit" | "read";

export function NoteEditor({
  note,
  store,
  collections,
  locked,
  editorRef,
  sessions,
  notes,
  backlinks,
  onOpenLink,
  target,
}: {
  note: KnowledgeNote;
  store: KnowledgeStore;
  collections: KnowledgeCollection[];
  locked: boolean;
  editorRef: Ref<EditorHandle>;
  sessions: EditorSessions;
  notes: readonly KnowledgeNote[];
  backlinks: readonly KnowledgeNote[];
  onOpenLink: (target: string) => void;
  target: { id: string; heading?: string; offset?: number; sequence: number } | null;
}) {
  const snapshot = useNoteDraft(note, store, locked);
  const { controller, note: draft, status, error } = snapshot;
  const { flush, change, initialError } = controller;
  const [mode, setMode] = useState<EditorMode>("edit");
  const [sourceMode, setSourceMode] = useState(false);
  const [settings, setSettings] = useState<ReadingSettings>(() =>
    decodeReadingSettings(localStorage.getItem(READING_SETTINGS_KEY)),
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [tagDraft, setTagDraft] = useState("");
  const [navigationError, setNavigationError] = useState("");
  const source = useRef<MarkdownEditorHandle>(null);
  const reading = useRef<HTMLElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const tools = useRef<HTMLDivElement>(null);
  const rename = useRef<LiveRename>(null);
  const body = useDeferredValue(draft.body);
  const analysis = useMemo(() => analyzeMarkdown(body), [body]);

  async function flushForNavigation() {
    await rename.current?.settle();
    await controller.flushForNavigation();
  }
  useUpdateParticipant({ blocked: () => null, save: flushForNavigation });
  useImperativeHandle(editorRef, () => ({ flush: flushForNavigation }), [controller]);

  function reveal(offset: number) {
    if (mode === "read")
      reading.current?.querySelector(`#note-heading-${offset}`)?.scrollIntoView({ block: "start" });
    else source.current?.reveal(offset);
  }
  useEffect(() => {
    if (!target || target.id !== note.id) return;
    const heading = target.heading;
    const found = heading
      ? analyzeMarkdown(controller.getSnapshot().note.body).headings.find(
          (item) => linkKey(item.text) === linkKey(heading),
        )
      : undefined;
    if (heading && !found) {
      setNavigationError(`未找到标题「${heading}」，笔记内容可能已更新。`);
      return;
    }
    setNavigationError("");
    setMode("edit");
    const frame = requestAnimationFrame(() =>
      source.current?.reveal(found?.from ?? target.offset ?? 0),
    );
    return () => cancelAnimationFrame(frame);
  }, [target, note.id, controller]);
  const [agentTarget, setAgentTarget] = useState<NoteSelection>(null);
  useNoteAgent(controller, agentTarget);

  // 菜单打开时：点外部或 Esc 收起。
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && !tools.current?.contains(event.target))
        setMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [menuOpen]);

  /**
   * 专注模式契约：开启时在最近的 .knowledge-app 根节点写 data-focus-mode="on"，
   * 退出时移除；knowledge.css 据此收起侧栏/标签栏/状态与编辑器元信息行。
   */
  useEffect(() => {
    setFocusMode(host.current?.closest(".knowledge-app")?.getAttribute("data-focus-mode") === "on");
  }, []);
  function toggleFocusMode(next: boolean) {
    const root = host.current?.closest(".knowledge-app");
    if (!root) return;
    if (next) root.setAttribute("data-focus-mode", "on");
    else root.removeAttribute("data-focus-mode");
    setFocusMode(next);
  }

  function updateSettings(patch: Partial<ReadingSettings>) {
    setSettings((current) => {
      const next = { ...current, ...patch };
      try {
        localStorage.setItem(READING_SETTINGS_KEY, JSON.stringify({ version: 1, ...next }));
      } catch {
        /* 存储受限时设置只在本次会话生效。 */
      }
      return next;
    });
  }

  const templates = notes.filter(
    (item) => item.id !== note.id && item.tags.some((tag) => tag === "模板" || tag === "template"),
  );
  const context = (
    <NoteContext
      note={draft}
      notes={notes}
      analysis={analysis}
      backlinks={backlinks}
      onReveal={reveal}
      onOpen={onOpenLink}
    />
  );

  return (
    <div className="knowledge-document" ref={host}>
      <section
        className="knowledge-editor"
        aria-label="笔记编辑器"
        data-reading-font={settings.font}
        data-reading-line={settings.lineHeight}
        data-source={sourceMode ? "on" : undefined}
      >
        <div className="knowledge-editor-meta">
          <Select
            aria-label="笔记所属集合"
            value={draft.collectionId ?? ""}
            disabled={locked || !!initialError}
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
          </Select>
          <span role="status">{status}</span>
          <div className="knowledge-mode-controls">
            <div className="knowledge-chip-group" role="group" aria-label="视图模式">
              <button
                type="button"
                aria-pressed={mode === "edit"}
                onClick={() => {
                  setMode("edit");
                  requestAnimationFrame(() => source.current?.focus());
                }}
              >
                编辑
              </button>
              <button type="button" aria-pressed={mode === "read"} onClick={() => setMode("read")}>
                阅读
              </button>
            </div>
            <Button
              variant="ghost"
              size="sm"
              aria-pressed={sourceMode}
              onClick={() => {
                setMode("edit");
                setSourceMode(!sourceMode);
              }}
            >
              源码
            </Button>
            <div className="knowledge-tools" ref={tools}>
              <Button
                variant="ghost"
                size="sm"
                className="knowledge-tools-toggle"
                aria-label="更多写作工具"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((open) => !open)}
              >
                ⋯
              </Button>
              <div className="knowledge-tools-menu" data-open={menuOpen ? "true" : undefined}>
                <details className="knowledge-tools-section">
                  <summary>插入模板</summary>
                  <div className="knowledge-tools-list">
                    {templates.length ? (
                      templates.map((template) => (
                        <button
                          type="button"
                          key={template.id}
                          onClick={() => {
                            setMode("edit");
                            source.current?.insert(fillTemplate(template.body, draft.title));
                            setMenuOpen(false);
                          }}
                        >
                          {template.title || "未命名模板"}
                        </button>
                      ))
                    ) : (
                      <p className="knowledge-hint">给笔记打上「模板」标签后可在此插入。</p>
                    )}
                  </div>
                </details>
                <button
                  type="button"
                  aria-pressed={sourceMode}
                  onClick={() => setSourceMode(!sourceMode)}
                >
                  源码模式
                </button>
                <button
                  type="button"
                  aria-pressed={focusMode}
                  onClick={() => toggleFocusMode(!focusMode)}
                >
                  专注模式
                </button>
                <button
                  type="button"
                  aria-pressed={settings.typewriter}
                  onClick={() => updateSettings({ typewriter: !settings.typewriter })}
                >
                  打字机模式
                </button>
                <div className="knowledge-tools-row">
                  <span className="ui-section-label">阅读字体</span>
                  <div className="knowledge-chip-group">
                    <button
                      type="button"
                      aria-pressed={settings.font === "sans"}
                      onClick={() => updateSettings({ font: "sans" })}
                    >
                      无衬线
                    </button>
                    <button
                      type="button"
                      aria-pressed={settings.font === "serif"}
                      onClick={() => updateSettings({ font: "serif" })}
                    >
                      衬线
                    </button>
                  </div>
                </div>
                <div className="knowledge-tools-row">
                  <span className="ui-section-label">行高</span>
                  <div className="knowledge-chip-group">
                    {(["compact", "standard", "loose"] as const).map((line) => (
                      <button
                        type="button"
                        key={line}
                        aria-pressed={settings.lineHeight === line}
                        onClick={() => updateSettings({ lineHeight: line })}
                      >
                        {line === "compact" ? "紧凑" : line === "standard" ? "标准" : "宽松"}
                      </button>
                    ))}
                  </div>
                </div>
                <details className="knowledge-tools-section">
                  <summary>快捷键</summary>
                  <p className="knowledge-hint">[[ 关联笔记 · / 插入 · Ctrl/⌘+F 查找</p>
                </details>
              </div>
            </div>
          </div>
        </div>
        {error && (
          <div role="alert" className="knowledge-alert">
            {error}
            {!initialError && (
              <Button variant="ghost" size="sm" onClick={() => void flush().catch(() => undefined)}>
                重试保存
              </Button>
            )}
          </div>
        )}
        {navigationError && (
          <p role="status" className="knowledge-hint">
            {navigationError}
          </p>
        )}
        <NoteRename controller={controller} snapshot={snapshot} store={store} renameRef={rename} />
        {/* 小屏（<1100px）：上下文收在标题下方的折叠段；宽屏用右侧持久栏。 */}
        <details className="knowledge-context-inline">
          <summary>大纲与链接</summary>
          {context}
        </details>
        <div className="knowledge-tags">
          {draft.tags.map((tag) => (
            <button
              type="button"
              key={tag}
              className="knowledge-tag-chip"
              aria-label={`移除标签 ${tag}`}
              onClick={() => change({ tags: draft.tags.filter((item) => item !== tag) })}
            >
              {tag}
            </button>
          ))}
          <input
            className="knowledge-tag-input"
            aria-label="笔记标签"
            placeholder="添加标签，用逗号或回车分隔"
            value={tagDraft}
            disabled={locked || !!initialError}
            onChange={(event) => {
              const parts = event.target.value.split(/[,，]/u);
              const additions = parts.map((item) => item.trim()).filter(Boolean);
              if (parts.length > 1) {
                if (additions.length)
                  change({ tags: [...new Set([...draft.tags, ...additions])].slice(0, 100) });
                setTagDraft("");
              } else setTagDraft(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                const addition = tagDraft.trim();
                if (addition)
                  change({ tags: [...new Set([...draft.tags, addition])].slice(0, 100) });
                setTagDraft("");
              } else if (event.key === "Backspace" && !tagDraft && draft.tags.length) {
                change({ tags: draft.tags.slice(0, -1) });
              }
            }}
          />
        </div>
        <div hidden={mode === "read"}>
          <MarkdownEditor
            sessionId={note.id}
            sessions={sessions}
            notes={notes}
            onOpenLink={onOpenLink}
            editorRef={source}
            live={!sourceMode}
            typewriter={settings.typewriter}
            slashContext={() => ({ id: note.id, title: draft.title })}
            label="笔记正文"
            placeholder={"从这里开始写。\n\n支持 Markdown，也可以把资料摘录带进来慢慢整理。"}
            value={draft.body}
            readOnly={locked || !!initialError}
            maxLength={500_000}
            onChange={(body) => change({ body })}
            onSelectionChange={(ranges) => setAgentTarget(ranges[0] ?? null)}
          />
        </div>
        {mode === "read" && (
          <article ref={reading} className="knowledge-prose">
            {body ? (
              <Markdown
                remarkPlugins={[remarkGfm, remarkKnowledgeLinks]}
                components={{
                  img: ({ alt }) => <span>[图片：{alt || "附件"} · 首期不自动加载外部资源]</span>,
                  a: ({ children, href }) => {
                    const prefix = "#knowledge-link=";
                    const target = href?.startsWith(prefix)
                      ? decodeURIComponent(href.slice(prefix.length))
                      : internalTarget(href ?? "");
                    return target !== null ? (
                      <a
                        href={href}
                        onClick={(event) => {
                          event.preventDefault();
                          onOpenLink(target);
                        }}
                      >
                        {children}
                      </a>
                    ) : (
                      <a href={href} target="_blank" rel="noreferrer noopener">
                        {children}
                      </a>
                    );
                  },
                }}
              >
                {body}
              </Markdown>
            ) : (
              <p className="knowledge-hint">开始记录你的第一个想法。</p>
            )}
          </article>
        )}
        <footer className="knowledge-editor-footer">
          <span>{draft.body.length.toLocaleString()} 字符</span>
        </footer>
      </section>
      {context}
    </div>
  );
}
