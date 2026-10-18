import { GitHubError, GitHubNetworkError } from "./github";
import type { KnowledgeState } from "../session/model";
import { contentChanges } from "../session/contentChanges";
import type { SyncSummary } from "./sync";

export type SyncPhase = "saving" | "reading" | "merging" | "uploading" | "confirming";

export const syncPhaseText: Record<SyncPhase, string> = {
  saving: "正在保存本机修改",
  reading: "正在读取远端内容",
  merging: "正在合并双方修改",
  uploading: "正在上传修改与附件",
  confirming: "正在确认同步结果",
};

export interface SyncFailure {
  kind: "network" | "credentials" | "permission" | "blocked";
  message: string;
  retryable: boolean;
  retryAfterMs?: number | undefined;
}

export interface SyncFeedback {
  online: boolean;
  phase: SyncPhase | null;
  failure: SyncFailure | null;
  retryAt: number | null;
  lastCheckedAt: number | null;
  lastChangedAt: number | null;
  lastResult: (SyncSummary & { conflicts: number }) | null;
}

export function completedSyncFeedback(
  previous: SyncFeedback,
  summary: SyncSummary,
  conflicts: number,
  now = Date.now(),
): SyncFeedback {
  return {
    ...previous,
    phase: null,
    failure: null,
    retryAt: null,
    lastCheckedAt: now,
    lastChangedAt: summary.uploaded || summary.downloaded ? now : previous.lastChangedAt,
    lastResult: { ...summary, conflicts },
  };
}

export function syncResultText(result: NonNullable<SyncFeedback["lastResult"]>) {
  return result.conflicts
    ? `发现 ${result.conflicts} 处冲突，双方版本已保留`
    : result.uploaded || result.downloaded
      ? `上传 ${result.uploaded} 项，接收 ${result.downloaded} 项`
      : "检查完成，没有新改动";
}

export function syncFailure(reason: unknown): SyncFailure {
  const message = reason instanceof Error ? reason.message : "同步未完成，请重试或检查同步设置。";
  if (reason instanceof GitHubNetworkError) return { kind: "network", message, retryable: true };
  if (reason instanceof GitHubError) {
    if (reason.status === 401) return { kind: "credentials", message, retryable: false };
    if (reason.retryable)
      return { kind: "network", message, retryable: true, retryAfterMs: reason.retryAfterMs };
    if (reason.status === 403) return { kind: "permission", message, retryable: false };
  }
  return { kind: "blocked", message, retryable: false };
}

/** An absolute retry deadline is shared by timers, focus events and saved edits. */
export function syncRetryDelay(attempt: number, retryAfterMs = 0) {
  return Math.max(Math.min(10_000 * 2 ** Math.min(attempt, 5), 300_000), retryAfterMs);
}

export function pendingSyncItems(state: KnowledgeState) {
  return contentChanges(state, state.sync.base).map(({ label, change }) => ({ label, change }));
}
