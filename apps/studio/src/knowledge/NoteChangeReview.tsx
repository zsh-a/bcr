import { useState } from "react";
import type { NoteChangePlan } from "./changePlan";
import { notePath } from "./paths";
import "./rename.css";

function excerpt(before: string, after: string) {
  let start = 0,
    end = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - end - 1] === after[after.length - end - 1]
  )
    end++;
  const from = Math.max(0, start - 100);
  const clip = (text: string) => {
    const to = Math.min(text.length, text.length - end + 100);
    const shown = text.slice(from, Math.min(to, from + 4000));
    return `${from ? "…\n" : ""}${shown}${to < text.length || to > from + 4000 ? "\n…" : ""}`;
  };
  return [clip(before), clip(after)];
}

export function NoteChangeReview({ plan }: { plan: NoteChangePlan }) {
  const [selected, setSelected] = useState(plan.changes[0]?.before.id);
  const [full, setFull] = useState(false);
  const change = plan.changes.find((item) => item.before.id === selected) ?? plan.changes[0];
  const snippets = change ? excerpt(change.before.body, change.after.body) : [];
  return (
    <>
      <div className="knowledge-rename-notes" aria-label="受影响的笔记">
        {plan.changes.map((item) => (
          <button
            type="button"
            key={item.before.id}
            className="knowledge-button"
            aria-pressed={change?.before.id === item.before.id}
            onClick={() => {
              setSelected(item.before.id);
              setFull(false);
            }}
          >
            {item.before.title || "未命名笔记"}
            <small>
              {notePath(item.before) !== notePath(item.after)
                ? "路径"
                : item.before.title !== item.after.title
                  ? "标题"
                  : "引用"}{" "}
              · {item.before.id.slice(0, 8)}
            </small>
          </button>
        ))}
      </div>
      {change && (
        <div className="knowledge-rename-diff">
          {notePath(change.before) !== notePath(change.after) && (
            <div className="knowledge-rename-title-diff">
              <span>原路径：{notePath(change.before)}</span>
              <strong>新路径：{notePath(change.after)}</strong>
            </div>
          )}
          {change.before.title !== change.after.title && (
            <div className="knowledge-rename-title-diff">
              <span>原标题：{change.before.title || "未命名笔记"}</span>
              <strong>新标题：{change.after.title || "未命名笔记"}</strong>
            </div>
          )}
          {change.before.body !== change.after.body && (
            <>
              <button
                type="button"
                className="knowledge-button"
                aria-pressed={full}
                onClick={() => setFull(!full)}
              >
                {full ? "仅看变更片段" : "查看完整正文"}
              </button>
              <div className="knowledge-rename-columns">
                <div>
                  <h3>修改前</h3>
                  <pre>{full ? change.before.body : snippets[0]}</pre>
                </div>
                <div>
                  <h3>修改后</h3>
                  <pre>{full ? change.after.body : snippets[1]}</pre>
                </div>
              </div>
              {!full && (
                <p className="knowledge-small">
                  仅显示变更附近片段，省略内容以 … 标记，可展开完整正文。
                </p>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}
