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

export interface EditorHandle {
  flush(): Promise<void>;
}
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
  const { controller, note: draft, status, error } = useNoteDraft(note, store, locked);
  const { flush, change, initialError } = controller;
  const [tagText, setTagText] = useState(draft.tags.join(", "));
  const [preview, setPreview] = useState(false);
  const [live, setLive] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [navigationError, setNavigationError] = useState("");
  const source = useRef<MarkdownEditorHandle>(null);
  const reading = useRef<HTMLElement>(null);
  const body = useDeferredValue(draft.body);
  const analysis = useMemo(() => analyzeMarkdown(body), [body]);
  function reveal(offset: number) {
    if (preview)
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
    setPreview(false);
    const frame = requestAnimationFrame(() =>
      source.current?.reveal(found?.from ?? target.offset ?? 0),
    );
    return () => cancelAnimationFrame(frame);
  }, [target, note.id, controller]);
  const [agentTarget, setAgentTarget] = useState<NoteSelection>(null);
  useNoteAgent(controller, agentTarget);
  useImperativeHandle(editorRef, () => ({ flush }), [flush]);
  useEffect(() => {
    if (!controller.getSnapshot().dirty) setTagText(controller.getSnapshot().note.tags.join(", "));
  }, [controller, note]);

  return (
    <div className={`knowledge-document ${contextOpen ? "with-context" : ""}`}>
      <section className="knowledge-editor" aria-label="笔记编辑器">
        <div className="knowledge-editor-meta">
          <select
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
          <button
            type="button"
            className="knowledge-button"
            aria-expanded={contextOpen}
            onClick={() => setContextOpen(!contextOpen)}
          >
            大纲与链接
          </button>
        </div>
        {error && (
          <div role="alert" className="knowledge-alert">
            {error}
            {!initialError && (
              <button type="button" onClick={() => void flush().catch(() => undefined)}>
                重试保存
              </button>
            )}
          </div>
        )}
        {navigationError && (
          <p role="status" className="knowledge-alert">
            {navigationError}
          </p>
        )}
        <input
          className="knowledge-title"
          aria-label="笔记标题"
          placeholder="给这个想法一个名字"
          value={draft.title}
          maxLength={500}
          disabled={locked || !!initialError}
          onChange={(e) => change({ title: e.target.value })}
        />
        <input
          className="knowledge-tags"
          aria-label="笔记标签"
          placeholder="添加标签，用逗号分隔"
          value={tagText}
          disabled={locked || !!initialError}
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
          onBlur={() => setTagText(controller.getSnapshot().note.tags.join(", "))}
        />
        <div className="knowledge-writing-tools">
          <button
            type="button"
            className="knowledge-button"
            aria-pressed={live}
            onClick={() => {
              setPreview(false);
              setLive(!live);
            }}
          >
            {live ? "源码模式" : "实时预览"}
          </button>
          <span>[[ 关联笔记 · / 插入 · Ctrl/⌘+F 查找</span>
          <select
            aria-label="插入笔记模板"
            value=""
            disabled={locked || !!initialError}
            onChange={(event) => {
              const template = notes.find((item) => item.id === event.target.value);
              if (!template) return;
              setPreview(false);
              const text = fillTemplate(template.body, draft.title);
              source.current?.insert(text);
            }}
          >
            <option value="">插入模板</option>
            {notes
              .filter(
                (item) =>
                  item.id !== note.id &&
                  item.tags.some((tag) => tag === "模板" || tag === "template"),
              )
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title || "未命名模板"}
                </option>
              ))}
          </select>
        </div>
        {preview && (
          <article ref={reading} className="knowledge-prose">
            <Markdown
              remarkPlugins={[remarkGfm, remarkKnowledgeLinks]}
              components={{
                img: ({ alt }) => (
                  <span className="text-muted">
                    [图片：{alt || "附件"} · 首期不自动加载外部资源]
                  </span>
                ),
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
              {draft.body || "开始记录你的第一个想法。"}
            </Markdown>
          </article>
        )}
        <div hidden={preview}>
          <MarkdownEditor
            sessionId={note.id}
            sessions={sessions}
            notes={notes}
            onOpenLink={onOpenLink}
            editorRef={source}
            live={live}
            label="笔记正文"
            placeholder={"从这里开始写。\n\n支持 Markdown，也可以把资料摘录带进来慢慢整理。"}
            value={draft.body}
            readOnly={locked || !!initialError}
            maxLength={500_000}
            onChange={(body) => change({ body })}
            onSelectionChange={(ranges) => setAgentTarget(ranges[0] ?? null)}
          />
        </div>
        <footer className="knowledge-editor-footer">
          <span>MARKDOWN</span>
          <span>{draft.body.length.toLocaleString()} 字符</span>
          <span>本地自动保存</span>
        </footer>
      </section>
      {contextOpen && (
        <NoteContext
          note={draft}
          notes={notes}
          analysis={analysis}
          backlinks={backlinks}
          onReveal={reveal}
          onOpen={onOpenLink}
        />
      )}
    </div>
  );
}
