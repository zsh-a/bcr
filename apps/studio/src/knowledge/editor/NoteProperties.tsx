import { useEffect, useRef, useState } from "react";
import { Select } from "@bcr/react";
import { ChevronRight, Paperclip, X } from "lucide-react";
import type { KnowledgeCollection, KnowledgeNote } from "../session/model";
import type { NoteDraft } from "./draft";

export function NoteProperties({
  controller,
  collections,
  disabled,
  characters,
}: {
  controller: NoteDraft;
  collections: KnowledgeCollection[];
  disabled: boolean;
  characters: number;
}) {
  const draft = controller.getSnapshot().note;
  const change = controller.change;
  const [tagDraft, setTagDraft] = useState("");
  const [tagEditing, setTagEditing] = useState(false);
  const tagInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (tagEditing) tagInput.current?.focus();
  }, [tagEditing]);
  return (
    <div className="knowledge-property-controls">
      <div className="knowledge-tags">
        {draft.tags.map((tag) => (
          <button
            type="button"
            key={tag}
            className="knowledge-tag-chip"
            aria-label={`移除标签 ${tag}`}
            disabled={disabled}
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
            disabled={disabled}
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
              if (addition && !disabled)
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
            disabled={disabled}
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
        disabled={disabled}
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
      <span className="knowledge-editor-count">
        正文 {characters.toLocaleString()} 字 · 源码 {draft.body.length.toLocaleString()} 字符
      </span>
    </div>
  );
}

export function NoteMetadata({
  note,
  collections,
  characters,
  attachments,
  onOpen,
}: {
  note: KnowledgeNote;
  collections: KnowledgeCollection[];
  characters: number;
  attachments: number;
  onOpen: (view: "properties" | "attachments") => void;
}) {
  const collection = collections.find((item) => item.id === note.collectionId)?.name;
  return (
    <>
      <button
        type="button"
        className="knowledge-metadata-summary"
        aria-label="编辑笔记属性"
        onClick={() => onOpen("properties")}
      >
        {collection && <span>{collection}</span>}
        {note.tags.length > 0 && <span>{note.tags.slice(0, 3).join(" · ")}</span>}
        {!collection && !note.tags.length && <span>添加属性</span>}
        <ChevronRight size={14} aria-hidden="true" />
      </button>
      <span className="knowledge-document-stats">
        {characters > 0 && <span>{characters.toLocaleString()} 字</span>}
        {attachments > 0 && (
          <button type="button" aria-label="查看笔记附件" onClick={() => onOpen("attachments")}>
            <Paperclip size={13} />
            {attachments} 个附件
          </button>
        )}
      </span>
    </>
  );
}
