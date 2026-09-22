import { useEffect, useImperativeHandle, useState, type Ref } from "react";
import Markdown from "react-markdown";
import { type KnowledgeNote, type KnowledgeCollection } from "./model";
import { MarkdownEditor } from "./MarkdownEditor";
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
}: {
  note: KnowledgeNote;
  store: KnowledgeStore;
  collections: KnowledgeCollection[];
  locked: boolean;
  editorRef: Ref<EditorHandle>;
}) {
  const { controller, note: draft, status, error } = useNoteDraft(note, store, locked);
  const { flush, change, initialError } = controller;
  const [tagText, setTagText] = useState(draft.tags.join(", "));
  const [preview, setPreview] = useState(false);
  const [agentTarget, setAgentTarget] = useState<NoteSelection>(null);
  useNoteAgent(controller, agentTarget);
  useImperativeHandle(editorRef, () => ({ flush }), [flush]);
  useEffect(() => {
    if (!controller.getSnapshot().dirty) setTagText(controller.getSnapshot().note.tags.join(", "));
  }, [controller, note]);

  return (
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
          readOnly={locked || !!initialError}
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
