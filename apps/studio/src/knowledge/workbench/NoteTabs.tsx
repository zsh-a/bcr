import { ChevronDown, Pin, X } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import type { KnowledgeNote } from "../session/model";
import { visibleNoteTabs } from "./noteTabsModel";
import { MAX_TABS } from "./workbench";

/** Open documents share the app toolbar; each tab can be pinned and closed. */
export function NoteTabs({
  notes,
  ids,
  pinned,
  activeId,
  onSelect,
  onOpen,
  onClose,
  onTogglePin,
}: {
  notes: Record<string, KnowledgeNote>;
  ids: string[];
  pinned: readonly string[];
  activeId: string | undefined;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onClose: (id: string) => void;
  onTogglePin: (id: string) => void;
}) {
  const strip = useRef<HTMLElement>(null);
  const [overflow, setOverflow] = useState(false);
  const tabs = visibleNoteTabs(ids, notes, activeId);
  const labels = tabs.map((id) => notes[id]!.title).join("\0");
  useLayoutEffect(() => {
    const element = strip.current;
    if (!element) return;
    const reveal = () => {
      setOverflow(element.scrollWidth > element.clientWidth + 1);
      element
        .querySelector(".knowledge-tab.active")
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
    };
    const observer = new ResizeObserver(reveal);
    observer.observe(element);
    reveal();
    return () => observer.disconnect();
  }, [activeId, ids, labels]);
  return (
    <div className="knowledge-tab-navigation">
      <nav
        ref={strip}
        className="knowledge-tabs"
        aria-label="打开的笔记"
        onKeyDown={(event) => {
          if (
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            !(event.target instanceof Element) ||
            !event.target.matches("[data-note-tab]")
          )
            return;
          const controls = [
            ...event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-note-tab]"),
          ];
          const index = controls.indexOf(event.target as HTMLButtonElement);
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? tabs.length - 1
                : event.key === "ArrowRight"
                  ? (index + 1) % tabs.length
                  : event.key === "ArrowLeft"
                    ? (index - 1 + tabs.length) % tabs.length
                    : -1;
          if (next < 0) return;
          event.preventDefault();
          controls[next]?.focus();
          onSelect(tabs[next]!);
        }}
      >
        {tabs.map((id) => {
          const name = notes[id]!.title || "未命名笔记";
          const isPinned = pinned.includes(id);
          const preview = !ids.includes(id);
          return (
            <div
              key={id}
              className={`knowledge-tab ${activeId === id ? "active" : ""}`}
              data-preview={preview || undefined}
            >
              <button
                type="button"
                data-note-tab={id}
                aria-current={activeId === id ? "page" : undefined}
                onClick={() => onSelect(id)}
                onDoubleClick={() => onOpen(id)}
                title={preview ? `${name} · 预览，双击固定到标签栏` : name}
              >
                {name}
              </button>
              <button
                type="button"
                className="knowledge-tab-pin"
                aria-label={`${isPinned ? "取消固定" : "固定"}标签 ${name}`}
                aria-pressed={isPinned}
                disabled={preview && pinned.length >= MAX_TABS}
                title={
                  preview && pinned.length >= MAX_TABS
                    ? "固定标签已达上限，请先取消一个固定标签"
                    : isPinned
                      ? "取消固定"
                      : "固定"
                }
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
      {overflow && (
        <label className="knowledge-tab-picker" title={`打开的笔记（${tabs.length}）`}>
          <ChevronDown size={16} aria-hidden="true" />
          <select
            aria-label="切换已打开的笔记"
            value={activeId ?? ""}
            onChange={(event) => onSelect(event.target.value)}
          >
            {!activeId && (
              <option value="" disabled>
                选择笔记
              </option>
            )}
            {tabs.map((id) => (
              <option key={id} value={id}>
                {notes[id]!.title || "未命名笔记"}
                {!ids.includes(id) ? " · 预览" : pinned.includes(id) ? " · 已固定" : ""}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
