import { useEffect, useRef, useState } from "react";
import type { KnowledgeNote } from "./model";
import { resolveNoteLink, type NoteAnalysis } from "./markdownAnalysis";

/**
 * 上下文栏：大纲 / 反向链接 / 出站链接。
 * 小节标题是 11px 大写等宽眉标（.ui-section-label 语言）且可折叠（默认展开）；
 * 计数为 0 时收敛成一行静默文案，说明文字退到 tooltip/aria-description；
 * 大纲带 h1/h2/h3 层级缩进，滚动时高亮当前标题。桌面为右侧常驻栏，
 * 小屏由 NoteEditor 包进标题下的折叠段。
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
  const host = useRef<HTMLElement>(null);
  const [current, setCurrent] = useState<number | null>(null);
  const { headings } = analysis;
  const body = note.body;

  /**
   * scrollspy：阅读态用渲染出的标题元素（#note-heading-<offset>），
   * 编辑态用 CodeMirror 行文本回查标题偏移；只测量当前可见元素。
   */
  useEffect(() => {
    if (!headings.length) {
      setCurrent(null);
      return;
    }
    let frame = 0;
    const update = () => {
      frame = 0;
      const scope = host.current?.closest(".knowledge-document");
      if (!scope) return;
      const byLine = new Map<string, number>();
      for (const heading of headings) {
        const end = body.indexOf("\n", heading.from);
        byLine.set(body.slice(heading.from, end < 0 ? body.length : end).trim(), heading.from);
      }
      const seen: { from: number; top: number }[] = [];
      for (const node of scope.querySelectorAll('[id^="note-heading-"]')) {
        if (!node.getClientRects().length) continue;
        const from = Number(node.id.slice("note-heading-".length));
        if (Number.isFinite(from)) seen.push({ from, top: node.getBoundingClientRect().top });
      }
      for (const line of scope.querySelectorAll(".cm-line")) {
        if (!line.getClientRects().length) continue;
        const from = byLine.get((line.textContent ?? "").trim());
        if (from !== undefined) seen.push({ from, top: line.getBoundingClientRect().top });
      }
      if (!seen.length) return;
      const limit = window.innerHeight * 0.3;
      const above = seen.filter((item) => item.top <= limit);
      const active = above.length
        ? above.reduce((best, item) => (item.top > best.top ? item : best))
        : seen.reduce((best, item) => (item.top < best.top ? item : best));
      setCurrent(active.from);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      document.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", onScroll);
    };
  }, [headings, body]);

  return (
    <aside ref={host} className={`knowledge-context ${className}`.trim()} aria-label="笔记上下文">
      <details className="knowledge-context-section" open>
        <summary className="ui-section-label knowledge-context-heading">
          大纲 <span>{headings.length}</span>
        </summary>
        {headings.length ? (
          headings.map((heading) => (
            <button
              type="button"
              key={heading.from}
              data-depth={heading.depth}
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
      </details>
      {backlinks.length ? (
        <details className="knowledge-context-section" open>
          <summary className="ui-section-label knowledge-context-heading">
            反向链接 <span>{backlinks.length}</span>
          </summary>
          {backlinks.map((source) => (
            <button type="button" key={source.id} onClick={() => onOpen(source.id)}>
              {source.title || "未命名笔记"}
            </button>
          ))}
        </details>
      ) : (
        <p
          className="knowledge-context-empty"
          title="还没有其他笔记引用这里。"
          aria-description="还没有其他笔记引用这里。"
        >
          无反向链接
        </p>
      )}
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
      ) : (
        <p
          className="knowledge-context-empty"
          title="输入 [[ 关联笔记，或 ⌘/Ctrl+点击链接打开。"
          aria-description="输入 [[ 关联笔记，或 ⌘/Ctrl+点击链接打开。"
        >
          无出站链接
        </p>
      )}
    </aside>
  );
}
