import { useMemo } from "react";
import { changeExcerpt } from "./changeExcerpt";

export function ChangePreview({ before, after }: { before: string; after: string }) {
  const excerpt = useMemo(() => changeExcerpt(before, after), [before, after]);
  return (
    <div className="bcr-chat-review">
      {excerpt.unchanged ? (
        <p className="bcr-chat-hint">内容没有变化。</p>
      ) : (
        <>
          <div className="bcr-chat-change-summary">
            {!before ? "新增内容" : "变更片段"}
            {excerpt.omitted > 0 && ` · 已折叠 ${excerpt.omitted} 行相同内容`}
          </div>
          <div className="bcr-chat-change-excerpt" tabIndex={0} role="region" aria-label="变更预览">
            {excerpt.before && (
              <div className="is-removed">
                <small>− 移除</small>
                <pre>{excerpt.before.slice(0, 6000)}</pre>
              </div>
            )}
            {excerpt.after && (
              <div className="is-added">
                <small>+ 新增</small>
                <pre>{excerpt.after.slice(0, 6000)}</pre>
              </div>
            )}
          </div>
          {(excerpt.before.length > 6000 || excerpt.after.length > 6000) && (
            <p className="bcr-chat-hint">预览已截取，确认前请展开完整内容。</p>
          )}
        </>
      )}
      <details className="bcr-chat-full-change">
        <summary>查看完整内容</summary>
        <div className="bcr-chat-full-content" tabIndex={0} role="region" aria-label="完整变更内容">
          {before && (
            <section>
              <h4>原内容</h4>
              <pre>{before}</pre>
            </section>
          )}
          <section>
            <h4>{before ? "修改后" : "新增内容"}</h4>
            <pre>{after || "（删除内容）"}</pre>
          </section>
        </div>
      </details>
    </div>
  );
}
