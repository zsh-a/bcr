import { useEffect, useId, useRef, useState } from "react";
import { Button, StatusDot } from "@bcr/react";
import { relativeTime } from "../editor/format";
import "./syncPopover.css";

/**
 * 同步状态插槽：一个状态点 + 一行合成文案，点击弹出同步浮层。
 * 浮层用原生 popover（ui.css 承担进出场），键盘 Esc 关闭并归还焦点。
 */

export interface SyncStatusFacts {
  error: string;
  conflicts: number;
  hasTarget: boolean;
  pending: number;
  lastSyncedAt: number | null;
  syncing: boolean;
}

export interface SyncStatusLine {
  text: string;
  tone: "muted" | "pending" | "synced" | "error";
  dot: string;
}

/** 合成唯一状态行；错误与冲突走 danger，其余按“已保存 → 待同步 → 已同步”递进。 */
export function composeStatusLine(facts: SyncStatusFacts, now = Date.now()): SyncStatusLine {
  const line: SyncStatusLine =
    facts.error !== ""
      ? { text: facts.error, tone: "error", dot: "sync-error" }
      : facts.conflicts > 0
        ? { text: `已保存 · ${facts.conflicts} 处冲突待处理`, tone: "error", dot: "sync-conflict" }
        : !facts.hasTarget
          ? { text: "已保存到本机", tone: "muted", dot: "sync-local" }
          : facts.pending > 0
            ? { text: `已保存 · ${facts.pending} 条待同步`, tone: "pending", dot: "sync-pending" }
            : facts.lastSyncedAt !== null
              ? {
                  text: `已同步 · ${relativeTime(facts.lastSyncedAt, now)}`,
                  tone: "synced",
                  dot: "sync-done",
                }
              : { text: "已保存到本机", tone: "muted", dot: "sync-local" };
  return facts.syncing ? { ...line, dot: "sync-running" } : line;
}

export function SyncStatus({
  facts,
  auto,
  onToggleAuto,
  onSync,
  onOpenSettings,
  onViewConflicts,
}: {
  facts: SyncStatusFacts;
  auto: boolean;
  onToggleAuto: (value: boolean) => void;
  onSync: () => void;
  onOpenSettings: () => void;
  onViewConflicts: () => void;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const line = composeStatusLine(facts);
  useEffect(() => {
    const element = pop.current;
    if (!element) return;
    const place = () => {
      if (!element.matches(":popover-open")) return;
      const anchor = trigger.current?.getBoundingClientRect();
      if (!anchor) return;
      const viewport = window.visualViewport;
      const visual = viewport?.scale === 1 ? viewport : null;
      const top = visual?.offsetTop ?? 0;
      const left = visual?.offsetLeft ?? 0;
      const height = visual?.height ?? window.innerHeight;
      const availableWidth = visual?.width ?? window.innerWidth;
      element.style.maxHeight = `${Math.max(0, height - 16)}px`;
      const width = element.offsetWidth || 280;
      setAt({
        top: Math.max(
          top + 8,
          Math.min(anchor.bottom + 8, top + height - element.offsetHeight - 8),
        ),
        left: Math.max(left + 8, Math.min(anchor.right - width, left + availableWidth - width - 8)),
      });
    };
    const toggle = () => {
      const shown = element.matches(":popover-open");
      setOpen(shown);
      if (shown) place();
      else if (document.activeElement === document.body) trigger.current?.focus();
    };
    element.addEventListener("toggle", toggle);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    const observer = new ResizeObserver(place);
    observer.observe(element);
    return () => {
      element.removeEventListener("toggle", toggle);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
      observer.disconnect();
    };
  }, []);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="knowledge-status-trigger"
        popoverTarget={id}
        aria-expanded={open}
        title="同步状态详情"
      >
        <StatusDot status={line.dot} />
        <span className={`knowledge-status-line is-${line.tone}`}>{line.text}</span>
      </button>
      <div
        ref={pop}
        id={id}
        popover="auto"
        className="ui-popover knowledge-sync-popover"
        style={at ? { top: at.top, left: at.left } : undefined}
      >
        <dl className="knowledge-sync-facts">
          <div>
            <dt>上次同步</dt>
            <dd>{facts.lastSyncedAt !== null ? relativeTime(facts.lastSyncedAt) : "尚未同步"}</dd>
          </div>
          <div>
            <dt>待同步</dt>
            <dd>{facts.pending > 0 ? `${facts.pending} 条` : "无待同步修改"}</dd>
          </div>
        </dl>
        <Button
          variant="primary"
          disabled={facts.syncing}
          onClick={() => {
            pop.current?.hidePopover();
            onSync();
          }}
        >
          {facts.syncing ? "同步中…" : "立即同步"}
        </Button>
        {facts.conflicts > 0 && (
          <Button
            variant="ghost"
            onClick={() => {
              pop.current?.hidePopover();
              onViewConflicts();
            }}
          >
            查看冲突
          </Button>
        )}
        <label className="knowledge-checkbox">
          <input type="checkbox" checked={auto} onChange={(e) => onToggleAuto(e.target.checked)} />
          自动同步
        </label>
        <Button
          variant="ghost"
          onClick={() => {
            pop.current?.hidePopover();
            onOpenSettings();
          }}
        >
          同步设置…
        </Button>
      </div>
    </>
  );
}
