import { Pin, X } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import type { KnowledgeNote } from "./model";

/** Open documents share the app toolbar; each tab can be pinned and closed. */
export function NoteTabs({
  notes,
  ids,
  pinned,
  activeId,
  onSelect,
  onClose,
  onTogglePin,
}: {
  notes: Record<string, KnowledgeNote>;
  ids: string[];
  pinned: readonly string[];
  activeId: string | undefined;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onTogglePin: (id: string) => void;
}) {
  const strip = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const element = strip.current;
    if (!element) return;
    const reveal = () =>
      element
        .querySelector(".knowledge-tab.active")
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
    const observer = new ResizeObserver(reveal);
    observer.observe(element);
    reveal();
    return () => observer.disconnect();
  }, [activeId, ids]);
  const tabs = ids.filter((id) => Object.hasOwn(notes, id));
  return (
    <nav ref={strip} className="knowledge-tabs" aria-label="打开的笔记">
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
  );
}
