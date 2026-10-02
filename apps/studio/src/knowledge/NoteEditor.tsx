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
import Markdown, { defaultUrlTransform } from "react-markdown";
import { createPortal } from "react-dom";
import { Download, Eye, Paperclip, Replace, SlidersHorizontal, Trash2, X } from "lucide-react";
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
  ContextMenu,
  IconButton,
  Dialog,
  Select,
  useMediaQuery,
  useNavigation,
  useUpdateParticipant,
} from "@bcr/react";
import {
  attachmentId,
  attachmentPath,
  attachmentReferences,
  type AttachmentReference,
} from "./attachmentModel";
import {
  AttachmentDialog,
  AttachmentInline,
  downloadAttachment,
  RemoteImage,
} from "./AttachmentView";
import { publishDocumentHandoff } from "@bcr/document-core";
import { canReadAttachmentText, readAttachmentText } from "./attachmentText";

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
  const [contextView, setContextView] = useState<
    "outline" | "links" | "properties" | "attachments"
  >("outline");
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
  const refs = useMemo(() => attachmentReferences(body), [body]);
  const [attachmentStatus, setAttachmentStatus] = useState({
    message: "",
    busy: false,
    error: false,
  });
  const [openedAttachment, setOpenedAttachment] = useState<string | null>(null);
  const [attachmentMenu, setAttachmentMenu] = useState<{
    ref: AttachmentReference;
    expected: string;
    x: number;
    y: number;
    trigger: HTMLElement;
  } | null>(null);
  const openedAsset = openedAttachment
    ? store.getSnapshot().attachments?.[openedAttachment]
    : undefined;
  const [attachmentText, setAttachmentText] = useState({
    body: "",
    busy: false,
    status: "",
    error: "",
  });
  const [textPage, setTextPage] = useState<Awaited<ReturnType<typeof readAttachmentText>> | null>(
    null,
  );
  const textController = useRef<AbortController | null>(null);
  const [ocrLanguage, setOcrLanguage] = useState<"en" | "ja">("en");
  useEffect(() => {
    setAttachmentText({ body: "", busy: false, status: "", error: "" });
    setTextPage(null);
    return () => textController.current?.abort();
  }, [openedAttachment, ocrLanguage]);
  async function extractAttachmentText(next = false) {
    if (!openedAsset || attachmentText.busy) return;
    textController.current?.abort();
    const controller = new AbortController();
    textController.current = controller;
    const page = next
      ? textPage?.nextOffset !== null
        ? (textPage?.page ?? 1)
        : (textPage?.nextPage ?? 1)
      : 1;
    const offset = next ? (textPage?.nextOffset ?? 0) : 0;
    setAttachmentText((previous) => ({
      ...previous,
      busy: true,
      error: "",
      status: openedAsset.mime.startsWith("image/")
        ? "正在运行本地 OCR，首次使用会加载识别模型…"
        : "正在读取附件文本…",
    }));
    try {
      const result = await readAttachmentText(store, openedAsset, {
        page,
        offset,
        ocr: true,
        language: ocrLanguage,
        signal: controller.signal,
      });
      controller.signal.throwIfAborted();
      setTextPage(result);
      setAttachmentText((previous) => ({
        body: next && offset ? previous.body + result.text : result.text,
        busy: false,
        error: "",
        status: `${result.label} · ${result.page} / ${result.totalPages}`,
      }));
    } catch (reason) {
      if (!controller.signal.aborted)
        setAttachmentText((previous) => ({
          ...previous,
          busy: false,
          error: reason instanceof Error ? reason.message : String(reason),
        }));
    }
  }
  const openAttachment = (id: string) => {
    if (!store.getSnapshot().attachments?.[id]) {
      setAttachmentStatus({ message: "附件记录缺失，请同步或恢复备份", busy: false, error: true });
      return;
    }
    setOpenedAttachment(id);
  };
  function menuAttachment(ref: AttachmentReference, x: number, y: number) {
    const target =
      document.elementFromPoint(x, y)?.closest<HTMLElement>("button") ?? document.activeElement;
    if (!(target instanceof HTMLElement)) return;
    setAttachmentMenu({
      ref,
      x,
      y,
      trigger: target,
      expected: controller.getSnapshot().note.body.slice(ref.from, ref.to),
    });
  }

  async function flushForNavigation() {
    await source.current?.flushAttachments();
    await rename.current?.settle();
    await controller.flushForNavigation();
  }
  useUpdateParticipant({
    blocked: () => (attachmentStatus.busy ? "附件正在保存，请完成后再更新。" : null),
    save: flushForNavigation,
  });
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
      attachmentCount={new Set(refs.map((ref) => ref.id)).size}
      attachments={
        <div className="knowledge-attachments-list">
          <Button
            variant="ghost"
            size="sm"
            disabled={locked || !!initialError}
            onClick={() => {
              setView("edit");
              source.current?.pickAttachment();
            }}
          >
            <Paperclip size={15} />
            添加附件
          </Button>
          {[...new Map(refs.map((ref) => [ref.id, ref])).values()].map((ref) => (
            <AttachmentInline
              key={ref.id}
              asset={store.getSnapshot().attachments?.[ref.id]}
              storage={store.attachments}
              label={ref.label}
              onOpen={() => openAttachment(ref.id)}
              onMenu={(x, y) => menuAttachment(ref, x, y)}
            />
          ))}
          {!refs.length && (
            <p className="knowledge-context-empty">粘贴截图或拖入文件，附件会随笔记保存。</p>
          )}
        </div>
      }
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
              <IconButton
                label="插入附件"
                size="sm"
                disabled={locked || !!initialError}
                onClick={() => {
                  setView("edit");
                  source.current?.pickAttachment();
                }}
              >
                <Paperclip size={16} />
              </IconButton>
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
        {attachmentStatus.message && (
          <div
            className="knowledge-attachment-status"
            data-error={attachmentStatus.error || undefined}
            role={attachmentStatus.error ? "alert" : "status"}
          >
            <Paperclip size={14} />
            {attachmentStatus.message}
            {attachmentStatus.error && (
              <IconButton
                label="关闭附件提示"
                size="sm"
                onClick={() => setAttachmentStatus({ message: "", busy: false, error: false })}
              >
                <X size={14} />
              </IconButton>
            )}
          </div>
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
            attachmentStore={store}
            onOpenAttachment={openAttachment}
            onAttachmentMenu={menuAttachment}
            onAttachmentStatus={(message, busy, error = false) =>
              setAttachmentStatus({ message, busy, error })
            }
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
                urlTransform={(url) => (attachmentId(url) ? url : defaultUrlTransform(url))}
                components={{
                  img: ({ alt, src, node: imageNode }) => {
                    const id = attachmentId(typeof src === "string" ? src : "");
                    const ref = refs.find(
                      (item) => item.id === id && item.from === imageNode?.position?.start.offset,
                    );
                    return id ? (
                      <AttachmentInline
                        asset={store.getSnapshot().attachments?.[id]}
                        storage={store.attachments}
                        label={alt || ""}
                        image
                        onOpen={() => openAttachment(id)}
                        onMenu={ref ? (x, y) => menuAttachment(ref, x, y) : undefined}
                      />
                    ) : (
                      <RemoteImage
                        src={typeof src === "string" ? src : ""}
                        alt={alt || "外部图片"}
                        onSave={
                          locked
                            ? undefined
                            : async (file) => {
                                const start = imageNode?.position?.start.offset,
                                  end = imageNode?.position?.end.offset;
                                if (start === undefined || end === undefined) return;
                                setView("edit");
                                source.current?.insertFiles([file], {
                                  from: start,
                                  to: end,
                                  expected: body.slice(start, end),
                                });
                              }
                        }
                      />
                    );
                  },
                  a: ({ children, href, node: linkNode }) => {
                    const id = attachmentId(href ?? "");
                    if (id) {
                      const ref = refs.find(
                        (item) => item.id === id && item.from === linkNode?.position?.start.offset,
                      );
                      return (
                        <AttachmentInline
                          asset={store.getSnapshot().attachments?.[id]}
                          storage={store.attachments}
                          label={ref?.label || ""}
                          onOpen={() => openAttachment(id)}
                          onMenu={ref ? (x, y) => menuAttachment(ref, x, y) : undefined}
                        />
                      );
                    }
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
      {openedAsset && (
        <AttachmentDialog
          key={openedAsset.id}
          asset={openedAsset}
          storage={store.attachments}
          onClose={() => setOpenedAttachment(null)}
          text={attachmentText}
          ocrLanguage={ocrLanguage}
          onOcrLanguageChange={setOcrLanguage}
          onReadText={
            canReadAttachmentText(openedAsset) ? () => void extractAttachmentText() : undefined
          }
          onNextText={
            textPage && (textPage.nextOffset !== null || textPage.nextPage !== null)
              ? () => void extractAttachmentText(true)
              : undefined
          }
          onReader={
            openedAsset.mime === "application/pdf" ||
            /\.(?:epub|docx|txt|md|markdown|html|fb2)$/iu.test(openedAsset.name)
              ? () =>
                  void (async () => {
                    await flushForNavigation();
                    const blob = await store.attachments.require(openedAsset);
                    const format = (await import("@bcr/document-core")).formatForName(
                      openedAsset.name,
                      openedAsset.mime,
                    );
                    const id = publishDocumentHandoff({
                      jobId: `knowledge-${openedAsset.id}`,
                      target: "reader",
                      name: openedAsset.name,
                      format,
                      size: openedAsset.size,
                      file: new File([blob], openedAsset.name, { type: openedAsset.mime }),
                      sourceRef: {
                        id: attachmentPath(openedAsset.hash),
                        hash: openedAsset.hash,
                        storage: "opfs",
                        type: "file/document",
                        format: openedAsset.mime,
                      },
                    });
                    navigation.navigate(`/reader?document=${encodeURIComponent(id)}`);
                  })().catch((reason) =>
                    setAttachmentStatus({ message: String(reason), busy: false, error: true }),
                  )
              : undefined
          }
        />
      )}
      {attachmentMenu && (
        <ContextMenu
          label="附件操作"
          title={store.getSnapshot().attachments?.[attachmentMenu.ref.id]?.name ?? "附件"}
          x={attachmentMenu.x}
          y={attachmentMenu.y}
          trigger={attachmentMenu.trigger}
          onClose={() => setAttachmentMenu(null)}
          actions={[
            {
              id: "open",
              label: "查看附件",
              icon: <Eye size={15} />,
              run: () => openAttachment(attachmentMenu.ref.id),
            },
            {
              id: "download",
              label: "下载原文件",
              icon: <Download size={15} />,
              run: () => {
                const asset = store.getSnapshot().attachments?.[attachmentMenu.ref.id];
                if (asset)
                  void store.attachments
                    .require(asset)
                    .then((blob) => downloadAttachment(blob, asset.name))
                    .catch((reason) =>
                      setAttachmentStatus({ message: String(reason), busy: false, error: true }),
                    );
              },
            },
            {
              id: "replace",
              label: "替换附件",
              icon: <Replace size={15} />,
              disabled: locked || !!initialError,
              separated: true,
              run: () => {
                setView("edit");
                source.current?.pickAttachment(attachmentMenu.ref.image, {
                  from: attachmentMenu.ref.from,
                  to: attachmentMenu.ref.to,
                  expected: attachmentMenu.expected,
                });
              },
            },
            {
              id: "remove",
              label: "移除当前引用",
              icon: <Trash2 size={15} />,
              disabled: locked || !!initialError,
              danger: true,
              run: () => {
                if (
                  !source.current?.replaceRange(
                    attachmentMenu.ref.from,
                    attachmentMenu.ref.to,
                    "",
                    attachmentMenu.expected,
                  )
                )
                  setAttachmentStatus({
                    message: "正文已变化，请重新选择附件",
                    busy: false,
                    error: true,
                  });
              },
            },
          ]}
        />
      )}
    </div>
  );
}
