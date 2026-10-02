import {
  useDeferredValue,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Ref,
} from "react";
import Markdown from "react-markdown";
import { createPortal } from "react-dom";
import { SlidersHorizontal, X } from "lucide-react";
import remarkGfm from "remark-gfm";
import { type KnowledgeNote, type KnowledgeCollection } from "./model";
import { MarkdownEditor, type MarkdownEditorHandle } from "./MarkdownEditor";
import type { EditorSessions } from "./editorSessions";
import { analyzeMarkdown, internalTarget, remarkKnowledgeLinks, linkKey } from "./markdownAnalysis";
import { NoteContext } from "./NoteContext";
import { PanelResizer } from "./PanelResizer";
import { CONTEXT_MAX_WIDTH, CONTEXT_MIN_WIDTH } from "./workbench";
import { fillTemplate } from "./format";
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
import {
  Button,
  Dialog,
  Select,
  useMediaQuery,
  useNavigation,
  useUpdateParticipant,
} from "@bcr/react";

export interface EditorHandle {
  flush(): Promise<void>;
}

type EditorView = "edit" | "source" | "read";

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
  focusMode,
  contextOpen,
  onContextOpenChange,
  contextWidth,
  onContextWidthChange,
  toolbarSlot,
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
  /** 专注模式由外壳持有，以便命令面板与 Esc 也能开关。 */
  focusMode: boolean;
  /** 上下文栏形态与宽度由外壳（工作台偏好）持有，刷新后保持。 */
  contextOpen: boolean;
  onContextOpenChange: (open: boolean) => void;
  contextWidth: number | null;
  onContextWidthChange: (width: number | null) => void;
  /** 编辑/阅读切换与写作设置挂到应用工具栏，正文区不再重复一条工具栏。 */
  toolbarSlot: HTMLElement | null;
}) {
  const navigation = useNavigation();
  const narrow = useMediaQuery("(width < 68.75em)");
  const [contextView, setContextView] = useState<"outline" | "links" | "properties">("outline");
  const snapshot = useNoteDraft(note, store, locked);
  const { controller, note: draft, error } = snapshot;
  const { flush, change, initialError } = controller;
  const [view, setView] = useState<EditorView>("edit");
  const [settings, setSettings] = useState<ReadingSettings>(() =>
    decodeReadingSettings(localStorage.getItem(READING_SETTINGS_KEY)),
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  const menuAnchor = `--writing-menu-${menuId.replaceAll(/[^a-zA-Z0-9]/g, "")}`;
  const [tagDraft, setTagDraft] = useState("");
  const [tagEditing, setTagEditing] = useState(false);
  const tagInput = useRef<HTMLInputElement>(null);
  const [navigationError, setNavigationError] = useState("");
  const source = useRef<MarkdownEditorHandle>(null);
  const reading = useRef<HTMLElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const toolsMenu = useRef<HTMLDivElement>(null);
  const toolsTrigger = useRef<HTMLButtonElement>(null);
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
    if (view === "read")
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
    setView("edit");
    const frame = requestAnimationFrame(() =>
      source.current?.reveal(found?.from ?? target.offset ?? 0),
    );
    return () => cancelAnimationFrame(frame);
  }, [target, note.id, controller]);
  const [agentTarget, setAgentTarget] = useState<NoteSelection>(null);
  useNoteAgent(controller, agentTarget);

  // The optional reading face stays out of the default entry graph. Both
  // fonts are self-hosted; an unavailable subset can use the system fallback.
  useEffect(() => {
    if (settings.font === "serif" && view !== "source")
      void import("@fontsource-variable/noto-serif-sc/wght.css").catch(() => {});
  }, [settings.font, view]);

  // 标签输入立即聚焦；失焦提交，Escape 放弃尚未提交的输入。
  useEffect(() => {
    if (tagEditing) tagInput.current?.focus();
  }, [tagEditing]);

  // 原生浮层处理外部点击；Esc 先收起设置，并把焦点归还触发器。
  useEffect(() => {
    if (!menuOpen) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        toolsMenu.current?.hidePopover();
        toolsTrigger.current?.focus();
      }
    };
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("keydown", escape);
    };
  }, [menuOpen]);

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
  const properties = (
    <div className="knowledge-property-controls">
      <div className="knowledge-tags">
        {draft.tags.map((tag) => (
          <button
            type="button"
            key={tag}
            className="knowledge-tag-chip"
            aria-label={`移除标签 ${tag}`}
            disabled={locked || !!initialError}
            onClick={() => change({ tags: draft.tags.filter((item) => item !== tag) })}
          >
            {tag}
            <X size={12} aria-hidden="true" />
          </button>
        ))}
        {tagEditing ? (
          <input
            ref={tagInput}
            className="knowledge-tag-input"
            aria-label="笔记标签"
            placeholder="用逗号或回车分隔"
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
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Enter") {
                event.preventDefault();
                const addition = tagDraft.trim();
                if (addition)
                  change({ tags: [...new Set([...draft.tags, addition])].slice(0, 100) });
                setTagDraft("");
              } else if (event.key === "Escape") {
                event.preventDefault();
                setTagDraft("");
                setTagEditing(false);
              } else if (event.key === "Backspace" && !tagDraft && draft.tags.length) {
                change({ tags: draft.tags.slice(0, -1) });
              }
            }}
            onBlur={() => {
              const addition = tagDraft.trim();
              if (addition && !locked && !initialError)
                change({
                  tags: [...new Set([...controller.getSnapshot().note.tags, addition])].slice(
                    0,
                    100,
                  ),
                });
              setTagDraft("");
              setTagEditing(false);
            }}
          />
        ) : (
          <button
            type="button"
            className="knowledge-tag-add"
            aria-label="添加标签"
            disabled={locked || !!initialError}
            onClick={() => setTagEditing(true)}
          >
            + 标签
          </button>
        )}
      </div>
      <Select
        aria-label="笔记所属集合"
        className="knowledge-collection-select"
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
      <span className="knowledge-editor-count">{draft.body.length.toLocaleString()} 字符</span>
    </div>
  );
  const context = (
    <NoteContext
      note={draft}
      notes={notes}
      analysis={analysis}
      backlinks={backlinks}
      onReveal={(offset) => {
        if (narrow) {
          onContextOpenChange(false);
          // Reveal after the drawer restores its trigger focus.
          requestAnimationFrame(() => reveal(offset));
        } else reveal(offset);
      }}
      onOpen={(target) => {
        if (narrow) onContextOpenChange(false);
        onOpenLink(target);
      }}
      view={contextView}
      onViewChange={setContextView}
      properties={properties}
      onClose={() => onContextOpenChange(false)}
    />
  );

  return (
    <div
      className="knowledge-document"
      ref={host}
      onClickCapture={(event) => {
        if (!(event.target instanceof Element) || event.button !== 0) return;
        const link = event.target.closest<HTMLElement>("[data-link-target], a");
        const href = link?.dataset.linkTarget ?? link?.getAttribute("href");
        if (!href?.startsWith("/diagram?")) return;
        if (link?.dataset.linkTarget && !event.ctrlKey && !event.metaKey) return;
        event.preventDefault();
        event.stopPropagation();
        navigation.navigate(href);
      }}
      style={
        {
          "--w-context-override": contextWidth === null ? undefined : `${contextWidth}px`,
        } as CSSProperties
      }
    >
      {toolbarSlot &&
        createPortal(
          <div className="knowledge-mode-controls">
            <div className="knowledge-segmented" role="group" aria-label="视图模式">
              <button
                type="button"
                aria-pressed={view === "edit"}
                onClick={() => {
                  setView("edit");
                  requestAnimationFrame(() => source.current?.focus());
                }}
              >
                编辑
              </button>
              <button
                type="button"
                aria-pressed={view === "source"}
                onClick={() => setView("source")}
              >
                源码
              </button>
              <button type="button" aria-pressed={view === "read"} onClick={() => setView("read")}>
                阅读
              </button>
            </div>
            <div className="knowledge-tools">
              <button
                ref={toolsTrigger}
                type="button"
                className="knowledge-quiet-toggle knowledge-tools-toggle"
                aria-label="更多写作工具"
                aria-haspopup="dialog"
                aria-expanded={menuOpen}
                popoverTarget={menuId}
                style={{ anchorName: menuAnchor }}
              >
                <SlidersHorizontal size={15} aria-hidden="true" />
              </button>
              <div
                ref={toolsMenu}
                id={menuId}
                popover="auto"
                role="dialog"
                aria-label="写作与阅读设置"
                className="ui-popover ui-menu knowledge-tools-menu"
                style={{ positionAnchor: menuAnchor }}
                onToggle={(event) => {
                  if (event.target === event.currentTarget) setMenuOpen(event.newState === "open");
                }}
              >
                <details className="knowledge-tools-section">
                  <summary>插入模板</summary>
                  <div className="knowledge-tools-list">
                    {templates.length ? (
                      templates.map((template) => (
                        <button
                          type="button"
                          key={template.id}
                          onClick={() => {
                            setView("edit");
                            source.current?.insert(fillTemplate(template.body, draft.title));
                            toolsMenu.current?.hidePopover();
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
                <div className="ui-menu-separator" />
                {/* 视图分段在文档工具行已有同样的控件；外层可见时（容器 ≥640px）这里收起，避免同屏重复。 */}
                <div className="knowledge-tools-modes">
                  <div className="knowledge-tools-row">
                    <span className="ui-section-label">视图模式</span>
                    <div className="knowledge-chip-group">
                      <button
                        type="button"
                        aria-pressed={view === "edit"}
                        onClick={() => {
                          setView("edit");
                          requestAnimationFrame(() => source.current?.focus());
                        }}
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        aria-pressed={view === "source"}
                        onClick={() => setView("source")}
                      >
                        源码
                      </button>
                      <button
                        type="button"
                        aria-pressed={view === "read"}
                        onClick={() => setView("read")}
                      >
                        阅读
                      </button>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  aria-pressed={settings.typewriter}
                  onClick={() => updateSettings({ typewriter: !settings.typewriter })}
                >
                  打字机模式
                </button>
                <div className="ui-menu-separator" />
                <div className="knowledge-tools-row">
                  <span className="ui-section-label">阅读字体</span>
                  <div className="knowledge-chip-group" role="group" aria-label="阅读字体">
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
                  <span className="ui-section-label">字号</span>
                  <div className="knowledge-chip-group" role="group" aria-label="正文字号">
                    {(["small", "standard", "large"] as const).map((size) => (
                      <button
                        type="button"
                        key={size}
                        aria-pressed={settings.fontSize === size}
                        onClick={() => updateSettings({ fontSize: size })}
                      >
                        {size === "small" ? "小" : size === "standard" ? "标准" : "大"}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="knowledge-tools-row">
                  <span className="ui-section-label">行高</span>
                  <div className="knowledge-chip-group" role="group" aria-label="正文行高">
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
                <div className="ui-menu-separator" />
                <details className="knowledge-tools-section">
                  <summary>快捷键</summary>
                  <p className="knowledge-hint">
                    [[ 关联笔记 · / 插入 · Ctrl/⌘+F 查找 · Ctrl/⌘+B 侧栏 · Esc 退出专注模式
                  </p>
                </details>
              </div>
            </div>
          </div>,
          toolbarSlot,
        )}
      <section
        className="knowledge-editor"
        aria-label="笔记编辑器"
        data-reading-font={settings.font}
        data-reading-size={settings.fontSize}
        data-reading-line={settings.lineHeight}
        data-source={view === "source" ? "on" : undefined}
      >
        <div className="knowledge-editor-head">
          <NoteRename
            controller={controller}
            snapshot={snapshot}
            store={store}
            renameRef={rename}
          />
        </div>
        <div className="knowledge-editor-meta">
          <button
            type="button"
            className="knowledge-metadata-summary"
            aria-label="编辑笔记属性"
            onClick={() => {
              setContextView("properties");
              onContextOpenChange(true);
            }}
          >
            <span>
              {collections.find((item) => item.id === draft.collectionId)?.name || "未归类"}
            </span>
            <span>{draft.tags.length ? draft.tags.slice(0, 3).join(" · ") : "添加标签"}</span>
            <span>{draft.body.length.toLocaleString()} 字符</span>
          </button>
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
        {/* 阅读态用 hidden 收起；类名用于把它接进编辑区的 flex 纵列。 */}
        <div className="knowledge-editor-source" hidden={view === "read"}>
          <MarkdownEditor
            sessionId={note.id}
            sessions={sessions}
            notes={notes}
            onOpenLink={onOpenLink}
            editorRef={source}
            live={view !== "source"}
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
        {view === "read" && (
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
      </section>
      {narrow ? (
        <Dialog
          open={contextOpen && !focusMode}
          onClose={() => onContextOpenChange(false)}
          title="笔记信息"
          placement="drawer"
          className="knowledge-context-drawer"
        >
          {context}
        </Dialog>
      ) : (
        context
      )}
      {/* 右栏宽度手柄：贴在上下文栏左缘，宽度变量随拖拽写在本容器上。 */}
      <PanelResizer
        edge="left"
        variable="--w-context-override"
        label="调整上下文栏宽度"
        width={contextWidth}
        min={CONTEXT_MIN_WIDTH}
        max={CONTEXT_MAX_WIDTH}
        getPanel={() =>
          host.current?.querySelector<HTMLElement>(":scope > .knowledge-context") ?? null
        }
        onCommit={onContextWidthChange}
      />
    </div>
  );
}
