import { IconButton } from "@bcr/react";
import { X, ArrowLeft, ArrowRight } from "lucide-react";
import type { KnowledgeNote } from "./model";

export function NoteTabs({
  notes,
  ids,
  activeId,
  onSelect,
  onClose,
  history,
  onHistory,
}: {
  notes: Record<string, KnowledgeNote>;
  ids: string[];
  activeId: string | undefined;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  history: { back: boolean; forward: boolean };
  onHistory: (direction: -1 | 1) => void;
}) {
  const tabs = ids.filter((id) => Object.hasOwn(notes, id));
  return (
    <div className="knowledge-tabs-bar">
      <div className="knowledge-nav-history">
        <IconButton
          label="上一条笔记"
          size="sm"
          disabled={!history.back}
          onClick={() => onHistory(-1)}
        >
          <ArrowLeft size={16} />
        </IconButton>
        <IconButton
          label="下一条笔记"
          size="sm"
          disabled={!history.forward}
          onClick={() => onHistory(1)}
        >
          <ArrowRight size={16} />
        </IconButton>
      </div>
      <nav className="knowledge-tabs" aria-label="打开的笔记">
        {tabs.map((id) => (
          <div key={id} className={`knowledge-tab ${activeId === id ? "active" : ""}`}>
            <button
              type="button"
              aria-current={activeId === id ? "page" : undefined}
              onClick={() => onSelect(id)}
              title={notes[id]!.title}
            >
              {notes[id]!.title || "未命名笔记"}
            </button>
            <button
              type="button"
              aria-label={`关闭笔记标签 ${notes[id]!.title || "未命名笔记"}`}
              disabled={tabs.length === 1}
              onClick={() => onClose(id)}
            >
              <X size={13} />
            </button>
          </div>
        ))}
      </nav>
    </div>
  );
}
