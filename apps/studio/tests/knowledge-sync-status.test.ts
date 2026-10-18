import { describe, expect, it } from "vitest";
import { composeStatusLine } from "../src/knowledge/sync/syncPopover";
import { relativeTime } from "../src/knowledge/editor/format";
import {
  syncFailure,
  syncRetryDelay,
  pendingSyncItems,
  completedSyncFeedback,
  syncResultText,
  type SyncFeedback,
} from "../src/knowledge/sync/syncFeedback";
import { GitHubError, GitHubNetworkError } from "../src/knowledge/sync/github";
import { emptyKnowledge, pendingCount } from "../src/knowledge/session/model";

const facts = {
  error: "",
  conflicts: 0,
  hasTarget: true,
  pending: 0,
  lastSyncedAt: 1_000_000,
  syncing: false,
};

describe("sync status line", () => {
  it("never reports a synchronized note while its local draft is unsaved or failed", () => {
    const local = {
      noteId: "note",
      dirty: true,
      error: "",
      renamePending: false,
    };
    expect(composeStatusLine({ ...facts, local }).text).toBe("保存中…");
    expect(composeStatusLine({ ...facts, conflicts: 1, local }).text).toBe(
      "1 处冲突待处理 · 草稿保留",
    );
    expect(composeStatusLine({ ...facts, local: { ...local, error: "disk full" } })).toMatchObject({
      text: "保存失败 · 草稿保留",
      tone: "error",
    });
    expect(
      composeStatusLine({ ...facts, local: { ...local, dirty: false, renamePending: true } }).text,
    ).toBe("重命名待确认");
    expect(
      composeStatusLine({ ...facts, hasTarget: false, local: { ...local, dirty: false } }).text,
    ).toBe("已保存到本机");
  });
  it("formats relative time as 刚刚 / 分钟前 / 小时前 / 日期", () => {
    const now = 10 * 86_400_000;
    expect(relativeTime(now - 5_000, now)).toBe("刚刚");
    expect(relativeTime(now - 5 * 60_000, now)).toBe("5 分钟前");
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe("3 小时前");
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe(
      new Date(now - 2 * 86_400_000).toLocaleDateString(),
    );
    expect(relativeTime(Number.NaN)).toBe("未知时间");
  });

  it("composes the one saved line in order: local, pending, synced", () => {
    expect(
      composeStatusLine({ ...facts, hasTarget: false, lastSyncedAt: null }, 2_000_000),
    ).toEqual({
      text: "已保存到本机",
      tone: "muted",
      dot: "sync-local",
    });
    expect(composeStatusLine({ ...facts, pending: 3 }, 1_000_600)).toEqual({
      text: "已保存 · 3 条待同步",
      tone: "pending",
      dot: "sync-pending",
    });
    expect(composeStatusLine(facts, 1_000_600)).toEqual({
      text: "已同步 · 刚刚",
      tone: "synced",
      dot: "sync-done",
    });
    expect(composeStatusLine({ ...facts, lastSyncedAt: null }, 2_000_000).text).toBe(
      "已保存到本机",
    );
  });

  it("puts conflicts and errors in danger and lets errors win", () => {
    expect(composeStatusLine({ ...facts, conflicts: 2 }, 2_000_000)).toEqual({
      text: "已保存 · 2 处冲突待处理",
      tone: "error",
      dot: "sync-conflict",
    });
    expect(composeStatusLine({ ...facts, error: "同步失败", conflicts: 2 }, 2_000_000)).toEqual({
      text: "同步失败",
      tone: "error",
      dot: "sync-error",
    });
  });

  it("reports an in-flight sync instead of showing the previous success", () => {
    expect(composeStatusLine({ ...facts, pending: 1, syncing: true }, 2_000_000)).toEqual({
      text: "已保存到本机 · 正在同步",
      tone: "pending",
      dot: "sync-running",
    });
  });

  it("explains missing credentials, offline queues and suspended automatic retries", () => {
    const feedback: SyncFeedback = {
      online: true,
      phase: null,
      failure: null,
      retryAt: null,
      lastCheckedAt: null,
      lastChangedAt: null,
      lastResult: null,
    };
    expect(composeStatusLine({ ...facts, hasToken: false }).text).toBe(
      "已保存到本机 · 需要补充 Token",
    );
    expect(composeStatusLine({ ...facts, feedback: { ...feedback, online: false } }).text).toBe(
      "已保存到本机 · 等待联网",
    );
    expect(
      composeStatusLine({
        ...facts,
        feedback: { ...feedback, failure: syncFailure(new GitHubError(401)) },
      }).text,
    ).toContain("需要补充 Token");
    expect(
      composeStatusLine({
        ...facts,
        feedback: { ...feedback, failure: syncFailure(new GitHubNetworkError()) },
      }).text,
    ).toContain("等待重试");
    expect(
      composeStatusLine({
        ...facts,
        feedback: { ...feedback, failure: syncFailure(new GitHubError(403)) },
      }).text,
    ).toContain("同步需检查");
    expect(
      composeStatusLine({
        ...facts,
        hasToken: false,
        local: { noteId: "n", dirty: true, error: "disk full", renamePending: false },
      }).text,
    ).toBe("保存失败 · 草稿保留");
  });
});

describe("automatic retry policy", () => {
  it("retries transient failures but pauses invalid credentials, permissions and local failures", () => {
    for (const reason of [
      new GitHubNetworkError(),
      new GitHubNetworkError(true),
      new GitHubError(408),
      new GitHubError(429),
      new GitHubError(503),
    ])
      expect(syncFailure(reason).retryable).toBe(true);
    for (const reason of [
      new GitHubError(401),
      new GitHubError(403),
      new GitHubError(404),
      new GitHubError(422),
      new Error("disk full"),
    ])
      expect(syncFailure(reason).retryable).toBe(false);
  });
  it("honors quota headers without treating all 403 responses as transient", () => {
    const limited = new GitHubError(403, new Headers({ "retry-after": "120" }));
    expect(syncFailure(limited)).toMatchObject({ retryable: true, retryAfterMs: 120_000 });
    const reset = new GitHubError(
      403,
      new Headers({
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": String(Math.ceil(Date.now() / 1000) + 180),
      }),
    );
    expect(reset.retryAfterMs).toBeGreaterThanOrEqual(179_000);
    expect(syncRetryDelay(0, limited.retryAfterMs)).toBe(120_000);
    expect([0, 1, 2, 6].map((attempt) => syncRetryDelay(attempt))).toEqual([
      10_000, 20_000, 40_000, 300_000,
    ]);
  });
  it("counts folder-only edits as pending so they cannot masquerade as synchronized", () => {
    const state = { ...emptyKnowledge(), folders: ["空目录"] };
    expect(pendingCount(state)).toBe(1);
    expect(pendingSyncItems(state)).toEqual([{ label: "文件夹结构", change: "修改" }]);
  });
});

describe("completed sync feedback", () => {
  const initial: SyncFeedback = {
    online: true,
    phase: "reading",
    failure: syncFailure(new GitHubNetworkError()),
    retryAt: 10_000,
    lastCheckedAt: null,
    lastChangedAt: null,
    lastResult: null,
  };
  it("keeps content update time separate from subsequent no-change checks", () => {
    const uploaded = completedSyncFeedback(initial, { uploaded: 1, downloaded: 0 }, 0, 1000);
    expect(uploaded).toMatchObject({
      lastCheckedAt: 1000,
      lastChangedAt: 1000,
      failure: null,
      retryAt: null,
      phase: null,
    });
    expect(syncResultText(uploaded.lastResult!)).toBe("上传 1 项，接收 0 项");
    const unchanged = completedSyncFeedback(uploaded, { uploaded: 0, downloaded: 0 }, 0, 5000);
    expect(unchanged.lastCheckedAt).toBe(5000);
    expect(unchanged.lastChangedAt).toBe(1000);
    expect(syncResultText(unchanged.lastResult!)).toBe("检查完成，没有新改动");
    const downloaded = completedSyncFeedback(unchanged, { uploaded: 0, downloaded: 2 }, 0, 9000);
    expect(downloaded.lastChangedAt).toBe(9000);
    expect(syncResultText(downloaded.lastResult!)).toBe("上传 0 项，接收 2 项");
    expect(composeStatusLine({ ...facts, lastSyncedAt: 1, feedback: unchanged }, 5000).text).toBe(
      "已同步 · 刚刚",
    );
  });
  it("reports conflicts explicitly instead of a zero-count success", () => {
    const result = completedSyncFeedback(initial, { uploaded: 0, downloaded: 0 }, 2, 1000);
    expect(result.lastChangedAt).toBeNull();
    expect(syncResultText(result.lastResult!)).toBe("发现 2 处冲突，双方版本已保留");
  });
});
