import type { KnowledgeNote } from "./model";
import { resolveNoteLink, type NoteAnalysis } from "./markdownAnalysis";

/**
 * 上下文栏：大纲 / 反向链接 / 出站链接。
 * 小节标题是 11px 大写等宽眉标（.ui-section-label），链接行是普通 13px 文本；
 * 桌面为右侧常驻栏，小屏由 NoteEditor 包进标题下的折叠段。
 */
export function NoteContext({
  note,
  notes,
  analysis,
  backlinks,
  onReveal,
  onOpen,
  className = "",
}: {
  note: KnowledgeNote;
  notes: readonly KnowledgeNote[];
  analysis: NoteAnalysis;
  backlinks: readonly KnowledgeNote[];
  onReveal: (offset: number) => void;
  onOpen: (target: string) => void;
  /** 嵌入折叠段时传入附加类名（清除常驻栏样式）。 */
  className?: string;
}) {
  return (
    <aside className={`knowledge-context ${className}`.trim()} aria-label="笔记上下文">
      <section>
        <h2 className="ui-section-label">
          大纲 <span>{analysis.headings.length}</span>
        </h2>
        {analysis.headings.length ? (
          analysis.headings.map((heading) => (
            <button
              type="button"
              key={heading.from}
              style={{
                paddingLeft: `calc(var(--space-3) + ${heading.depth - 1} * var(--space-2))`,
              }}
              onClick={() => onReveal(heading.from)}
            >
              {heading.text}
            </button>
          ))
        ) : (
          <p>添加 Markdown 标题，整理文章结构。</p>
        )}
      </section>
      <section>
        <h2 className="ui-section-label">
          反向链接 <span>{backlinks.length}</span>
        </h2>
        {backlinks.length ? (
          backlinks.map((source) => (
            <button type="button" key={source.id} onClick={() => onOpen(source.id)}>
              {source.title || "未命名笔记"}
            </button>
          ))
        ) : (
          <p>还没有其他笔记引用这里。</p>
        )}
      </section>
      <section>
        <h2 className="ui-section-label">
          出站链接 <span>{analysis.links.length}</span>
        </h2>
        {analysis.links.slice(0, 100).map((link) => {
          const matches = resolveNoteLink(notes, link.target, note.id);
          return (
            <button
              type="button"
              key={`${link.from}:${link.to}`}
              onClick={() => onOpen(link.target)}
            >
              {link.label}
              <small>{matches.length > 1 ? "同名 · 请选择" : matches.length ? "" : "未创建"}</small>
            </button>
          );
        })}
        {!analysis.links.length && <p>输入 [[ 关联笔记，或 ⌘/Ctrl+点击链接打开。</p>}
      </section>
    </aside>
  );
}
