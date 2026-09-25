import { useState } from "react";
import { Button } from "@bcr/react";
import type { NoteChangePlan } from "./changePlan";
import { notePath } from "./paths";
import { DiffView } from "./diffView";
import "./diffView.css";

/** 修改计划审阅：笔记以「标题 + 路径」标识，正文差异用词级渲染片段呈现。 */
export function NoteChangeReview({ plan }: { plan: NoteChangePlan }) {
  const [selected, setSelected] = useState(plan.changes[0]?.before.id);
  const change = plan.changes.find((item) => item.before.id === selected) ?? plan.changes[0];
  return (
    <>
      <div className="knowledge-review-notes" aria-label="受影响的笔记">
        {plan.changes.map((item) => (
          <Button
            variant="default"
            key={item.before.id}
            aria-pressed={change?.before.id === item.before.id}
            onClick={() => setSelected(item.before.id)}
          >
            {item.before.title || "未命名笔记"}
            <small>
              {notePath(item.before) !== notePath(item.after)
                ? "路径"
                : item.before.title !== item.after.title
                  ? "标题"
                  : "引用"}{" "}
              · {notePath(item.after)}
            </small>
          </Button>
        ))}
      </div>
      {change && (
        <div className="knowledge-review-diff">
          {notePath(change.before) !== notePath(change.after) && (
            <div className="knowledge-review-meta">
              <span>原路径：{notePath(change.before)}</span>
              <strong>新路径：{notePath(change.after)}</strong>
            </div>
          )}
          {change.before.title !== change.after.title && (
            <div className="knowledge-review-meta">
              <span>原标题：{change.before.title || "未命名笔记"}</span>
              <strong>新标题：{change.after.title || "未命名笔记"}</strong>
            </div>
          )}
          {change.before.body !== change.after.body && (
            <DiffView before={change.before.body} after={change.after.body} />
          )}
        </div>
      )}
    </>
  );
}
