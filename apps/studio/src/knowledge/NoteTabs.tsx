import { Pin, X } from "lucide-react";
import type { ReactNode } from "react";
import type { KnowledgeNote } from "./model";

/** 显式标签栏：无历史箭头，每个标签可固定、可关闭；右端挂状态簇与笔记工具。 */
export function NoteTabs({
  notes,
  ids,
  pinned,
  activeId,
  onSelect,
  onClose,
  onTogglePin,
  actions,
}: {
  notes: Record<string, KnowledgeNote>;
  ids: string[];
  pinned: readonly string[];
  activeId: string | undefined;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onTogglePin: (id: string) => void;
  /** tab 条右端的安静工具区（收藏/历史/状态簇）。 */
  actions?: ReactNode;
}) {
  const tabs = ids.filter((id) => Object.hasOwn(notes, id));
  return (
    <div className="knowledge-tabs-bar">
      <nav className="knowledge-tabs" aria-label="打开的笔记">
        {tabs.map((id) => {
          const name = notes[id]!.title || "未命名笔记";
          const isPinned = pinned.includes(id);
          return (
            <div key={id} className={`knowledge-tab ${activeId === id ? "active" : ""}`}>
              <button
                type="button"
                aria-current={activeId === id ? "page" : undefined}
                onClick={() => onSelect(id)}
                title={name}
              >
                {name}
              </button>
              <button
                type="button"
                className="knowledge-tab-pin"
                aria-label={`${isPinned ? "取消固定" : "固定"}标签 ${name}`}
                aria-pressed={isPinned}
                title={isPinned ? "取消固定" : "固定"}
                onClick={() => onTogglePin(id)}
              >
                <Pin size={11} fill={isPinned ? "currentColor" : "none"} />
              </button>
              <button
                type="button"
                className="knowledge-tab-close"
                aria-label={`关闭标签 ${name}`}
                title="关闭"
                onClick={() => onClose(id)}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      </nav>
      {actions && <div className="knowledge-tabs-actions">{actions}</div>}
    </div>
  );
}
