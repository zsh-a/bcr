import { useEffect, useId, useRef, useState } from "react";
import { Button, StatusDot } from "@bcr/react";
import { relativeTime } from "../editor/format";
import "./syncPopover.css";
import { syncPhaseText, syncResultText, type SyncFeedback } from "./syncFeedback";
import type { GitTarget } from "../session/model";

/**
 * 同步状态插槽：一个状态点 + 一行合成文案，点击弹出同步浮层。
 * 浮层用原生 popover（ui.css 承担进出场），键盘 Esc 关闭并归还焦点。
 */

export interface LocalSaveStatus {
  noteId: string;
  dirty: boolean;
  error: string;
  renamePending: boolean;
}

export interface SyncStatusFacts {
  error: string;
  conflicts: number;
  hasTarget: boolean;
  pending: number;
  lastSyncedAt: number | null;
  syncing: boolean;
  local?: LocalSaveStatus;
  hasToken?: boolean;
  feedback?: SyncFeedback;
}

export interface SyncStatusLine {
  text: string;
  tone: "muted" | "pending" | "synced" | "error";
  dot: string;
}

/** 合成唯一状态行；错误与冲突走 danger，其余按“已保存 → 待同步 → 已同步”递进。 */
export function composeStatusLine(facts: SyncStatusFacts, now = Date.now()): SyncStatusLine {
  if (facts.local?.dirty && facts.conflicts > 0)
    return {
      text: `${facts.conflicts} 处冲突待处理 · 草稿保留`,
      tone: "error",
      dot: "sync-conflict",
    };
  if (facts.local?.error)
    return {
      text: facts.local.dirty ? "保存失败 · 草稿保留" : "保存需检查",
      tone: "error",
      dot: "sync-error",
    };
  if (facts.local?.dirty) return { text: "保存中…", tone: "pending", dot: "sync-running" };
  if (facts.local?.renamePending)
    return { text: "重命名待确认", tone: "pending", dot: "sync-pending" };
  if (facts.hasTarget && facts.syncing)
    return { text: "已保存到本机 · 正在同步", tone: "pending", dot: "sync-running" };
  if (facts.hasTarget && !facts.conflicts && !facts.error) {
    if (facts.feedback?.online === false)
      return { text: "已保存到本机 · 等待联网", tone: "pending", dot: "sync-pending" };
    if (facts.hasToken === false || facts.feedback?.failure?.kind === "credentials")
      return { text: "已保存到本机 · 需要补充 Token", tone: "pending", dot: "sync-pending" };
    if (facts.feedback?.failure)
      return {
        text: facts.feedback.failure.retryable
          ? "已保存到本机 · 等待重试"
          : "已保存到本机 · 同步需检查",
        tone: facts.feedback.failure.retryable ? "pending" : "error",
        dot: facts.feedback.failure.retryable ? "sync-pending" : "sync-error",
      };
  }
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
                  text: `已同步 · ${relativeTime(facts.feedback?.lastCheckedAt ?? facts.lastSyncedAt, now)}`,
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
  onRetrySave,
  target,
  pendingItems = [],
  compact = false,
}: {
  facts: SyncStatusFacts;
  auto: boolean;
  onToggleAuto: (value: boolean) => void;
  onSync: () => void;
  onOpenSettings: () => void;
  onViewConflicts: () => void;
  onRetrySave?: () => void;
  target?: GitTarget | null;
  pendingItems?: { label: string; change: string }[];
  compact?: boolean;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const line = composeStatusLine(facts, now);
  const needsToken = facts.hasToken === false || facts.feedback?.failure?.kind === "credentials";
  const online = facts.feedback?.online !== false;
  const failure = facts.feedback?.failure;
  const checkedAt = facts.feedback?.lastCheckedAt ?? facts.lastSyncedAt;
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
        title={`保存与同步状态：${line.text}`}
        aria-label={`保存与同步状态：${line.text}`}
      >
        <StatusDot status={line.dot} />
        <span className={`knowledge-status-line is-${line.tone}`} role="status">
          {compact && line.tone === "synced" ? "已同步" : line.text}
        </span>
      </button>
      <div
        ref={pop}
        id={id}
        popover="auto"
        className="ui-popover knowledge-sync-popover"
        style={at ? { top: at.top, left: at.left } : undefined}
      >
        {facts.local?.error && (
          <div className="knowledge-save-error">
            <p role="alert">{facts.local.error}</p>
            {facts.local.dirty && onRetrySave && (
              <Button variant="primary" onClick={onRetrySave}>
                重试保存
              </Button>
            )}
          </div>
        )}
        {facts.hasTarget ? (
          <>
            <dl className="knowledge-sync-facts">
              {target && (
                <div>
                  <dt>仓库</dt>
                  <dd>
                    {target.owner}/{target.repo}
                  </dd>
                </div>
              )}
              {target && (
                <div>
                  <dt>分支</dt>
                  <dd>{target.branch}</dd>
                </div>
              )}
              <div>
                <dt>最近成功检查</dt>
                <dd>
                  {checkedAt !== null ? (
                    <time
                      dateTime={new Date(checkedAt).toISOString()}
                      title={new Date(checkedAt).toLocaleString()}
                    >
                      {relativeTime(checkedAt, now)}
                    </time>
                  ) : (
                    "尚未检查"
                  )}
                </dd>
              </div>
              {facts.feedback?.lastChangedAt && (
                <div>
                  <dt title="本次打开后最近一次上传或接收内容">内容更新</dt>
                  <dd>
                    <time
                      dateTime={new Date(facts.feedback.lastChangedAt).toISOString()}
                      title={new Date(facts.feedback.lastChangedAt).toLocaleString()}
                    >
                      {relativeTime(facts.feedback.lastChangedAt, now)}
                    </time>
                  </dd>
                </div>
              )}
              <div>
                <dt>待同步</dt>
                <dd>{facts.pending > 0 ? `${facts.pending} 条` : "无待同步修改"}</dd>
              </div>
            </dl>
            {facts.feedback?.lastResult && !facts.syncing && (
              <p className="knowledge-sync-help knowledge-sync-result">
                上次检查结果：{syncResultText(facts.feedback.lastResult)}
              </p>
            )}
            {pendingItems.length > 0 && (
              <details className="knowledge-sync-changes">
                <summary>查看待同步修改（{pendingItems.length} 项）</summary>
                <ul>
                  {pendingItems.slice(0, 8).map((item, index) => (
                    <li key={index}>
                      <span>{item.label}</span>
                      <small>{item.change}</small>
                    </li>
                  ))}
                </ul>
                {pendingItems.length > 8 && <p>另有 {pendingItems.length - 8} 项修改</p>}
              </details>
            )}
            {facts.syncing && (
              <p className="knowledge-sync-help" role="status">
                {facts.feedback?.phase ? syncPhaseText[facts.feedback.phase] : "正在同步，请稍候"}…
              </p>
            )}
            {!online && (
              <p className="knowledge-sync-help">当前离线，修改已保存在本机，联网后可继续同步。</p>
            )}
            {failure && !facts.syncing && (
              <div className="knowledge-sync-error" role="alert">
                <p>{failure.message}</p>
                {auto && facts.feedback?.retryAt && online && (
                  <p>将在 {new Date(facts.feedback.retryAt).toLocaleTimeString()} 后自动重试。</p>
                )}
              </div>
            )}
            <Button
              variant="primary"
              disabled={facts.syncing || (!online && !needsToken && !facts.conflicts)}
              onClick={() => {
                if (needsToken || facts.conflicts) {
                  pop.current?.hidePopover();
                  if (facts.conflicts) onViewConflicts();
                  else onOpenSettings();
                } else onSync();
              }}
            >
              {facts.syncing
                ? "同步中…"
                : facts.conflicts
                  ? "查看冲突"
                  : needsToken
                    ? "补充 Token"
                    : failure
                      ? "重试同步"
                      : "立即同步"}
            </Button>
            <label className="knowledge-checkbox">
              <input
                type="checkbox"
                checked={auto}
                onChange={(e) => onToggleAuto(e.target.checked)}
              />
              自动同步
            </label>
            <p className="knowledge-sync-help">
              {auto
                ? needsToken
                  ? "自动同步已暂停，请补充 Token。"
                  : failure && !failure.retryable
                    ? "自动同步已暂停，处理问题后可手动重试。"
                    : !online
                      ? "自动同步正在等待联网。"
                      : "保存后自动同步，返回页面时检查远端更新。"
                : "自动同步已关闭，可随时手动同步。"}
            </p>
          </>
        ) : (
          <p className="knowledge-sync-local-help">
            笔记保存在这台设备上。设置同步后，可在其他设备继续使用。
          </p>
        )}
        {facts.conflicts > 0 && !facts.hasTarget && (
          <Button
            variant="primary"
            onClick={() => {
              pop.current?.hidePopover();
              onViewConflicts();
            }}
          >
            查看冲突
          </Button>
        )}
        <Button
          variant={facts.hasTarget || facts.conflicts ? "ghost" : "primary"}
          onClick={() => {
            pop.current?.hidePopover();
            onOpenSettings();
          }}
        >
          {facts.hasTarget ? "同步设置…" : "设置同步"}
        </Button>
      </div>
    </>
  );
}
