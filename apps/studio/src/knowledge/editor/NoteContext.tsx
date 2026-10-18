import { useRef, type ReactNode } from "react";
import { IconButton, ResourceViews } from "@bcr/react";
import { X } from "lucide-react";
import type { KnowledgeNote } from "../session/model";
import { resolveNoteLink, type NoteAnalysis } from "../notes/markdownAnalysis";
import { useOutlineFollow } from "./useOutlineFollow";

/** One optional context panel with outline, links, and editable properties. */
export function NoteContext({
  note,
  notes,
  analysis,
  backlinks,
  onReveal,
  onOpen,
  className = "",
  view,
  onViewChange,
  properties,
  attachments,
  attachmentCount = 0,
  onClose,
  body,
  mode,
}: {
  note: KnowledgeNote;
  notes: readonly KnowledgeNote[];
  analysis: NoteAnalysis;
  backlinks: readonly KnowledgeNote[];
  onReveal: (offset: number) => void;
  onOpen: (target: string) => void;
  /** Additional styles for a host panel. */
  className?: string;
  view: "outline" | "links" | "properties" | "attachments";
  onViewChange: (view: "outline" | "links" | "properties" | "attachments") => void;
  properties: ReactNode;
  attachments?: ReactNode;
  attachmentCount?: number;
  onClose: () => void;
  body: string;
  mode: "edit" | "source" | "read";
}) {
  const host = useRef<HTMLElement>(null);
  const { headings } = analysis;
  const current = useOutlineFollow(host, headings, body, mode);

  return (
    <aside ref={host} className={`knowledge-context ${className}`.trim()} aria-label="笔记上下文">
      <div className="knowledge-context-top">
        <ResourceViews
          label="笔记信息视图"
          views={[
            { id: "outline", label: "大纲", count: headings.length },
            { id: "links", label: "链接", count: backlinks.length + analysis.links.length },
            { id: "properties", label: "属性" },
            { id: "attachments", label: "附件", count: attachmentCount },
          ]}
          value={view}
          onValueChange={onViewChange}
        />
        <IconButton
          label="关闭笔记信息"
          className="knowledge-context-close"
          size="sm"
          onClick={onClose}
        >
          <X size={15} />
        </IconButton>
      </div>
      <div
        className="knowledge-context-panel"
        aria-label={
          view === "outline"
            ? "笔记大纲"
            : view === "links"
              ? "笔记链接"
              : view === "attachments"
                ? "笔记附件"
                : "笔记属性"
        }
      >
        {view === "outline" && (
          <section className="knowledge-context-section">
            {headings.length ? (
              headings.map((heading) => (
                <button
                  type="button"
                  key={heading.from}
                  disabled={body !== note.body}
                  data-depth={heading.depth}
                  title={heading.text}
                  className={current === heading.from ? "is-current" : undefined}
                  aria-current={current === heading.from ? "location" : undefined}
                  onClick={() => onReveal(heading.from)}
                >
                  {heading.text}
                </button>
              ))
            ) : (
              <p className="knowledge-context-empty" title="添加 Markdown 标题，整理文章结构。">
                无大纲标题
              </p>
            )}
          </section>
        )}
        {view === "links" && (
          <>
            {backlinks.length ? (
              <details className="knowledge-context-section" open>
                <summary className="ui-section-label knowledge-context-heading">
                  反向链接 <span>{backlinks.length}</span>
                </summary>
                {backlinks.map((source) => (
                  <button
                    type="button"
                    key={source.id}
                    title={source.title || "未命名笔记"}
                    onClick={() => onOpen(source.id)}
                  >
                    {source.title || "未命名笔记"}
                  </button>
                ))}
              </details>
            ) : null}
            {analysis.links.length ? (
              <details className="knowledge-context-section" open>
                <summary className="ui-section-label knowledge-context-heading">
                  出站链接 <span>{analysis.links.length}</span>
                </summary>
                {analysis.links.slice(0, 100).map((link) => {
                  const matches = resolveNoteLink(notes, link.target, note.id);
                  return (
                    <button
                      type="button"
                      key={`${link.from}:${link.to}`}
                      title={link.label}
                      onClick={() => onOpen(link.target)}
                    >
                      {link.label}
                      <small>
                        {matches.length > 1 ? "同名 · 请选择" : matches.length ? "" : "未创建"}
                      </small>
                    </button>
                  );
                })}
              </details>
            ) : null}
            {!backlinks.length && !analysis.links.length && (
              <p
                className="knowledge-context-empty"
                title="输入 [[ 关联笔记，或 ⌘/Ctrl+点击链接打开。"
              >
                输入 [[，连接相关笔记
              </p>
            )}
          </>
        )}
        {view === "properties" && properties}
        {view === "attachments" && attachments}
      </div>
    </aside>
  );
}
