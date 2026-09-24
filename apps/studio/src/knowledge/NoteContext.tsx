import type { KnowledgeNote } from "./model";
import { resolveNoteLink, type NoteAnalysis } from "./markdownAnalysis";

export function NoteContext({
  note,
  notes,
  analysis,
  backlinks,
  onReveal,
  onOpen,
}: {
  note: KnowledgeNote;
  notes: readonly KnowledgeNote[];
  analysis: NoteAnalysis;
  backlinks: readonly KnowledgeNote[];
  onReveal: (offset: number) => void;
  onOpen: (target: string) => void;
}) {
  return (
    <aside className="knowledge-context" aria-label="笔记上下文">
      <section>
        <h2>
          大纲 <span>{analysis.headings.length}</span>
        </h2>
        {analysis.headings.length ? (
          analysis.headings.map((heading) => (
            <button
              type="button"
              key={heading.from}
              style={{ paddingLeft: 12 + (heading.depth - 1) * 10 }}
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
        <h2>
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
        <h2>
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
        {!analysis.links.length && <p>输入 [[ 关联笔记，或在预览中点击链接。</p>}
      </section>
    </aside>
  );
}
