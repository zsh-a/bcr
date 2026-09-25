import { describe, expect, it } from "vitest";
import { composeStatusLine, relativeTime } from "../src/knowledge/syncPopover";

const facts = {
  error: "",
  conflicts: 0,
  hasTarget: true,
  pending: 0,
  lastSyncedAt: 1_000_000,
  syncing: false,
};

describe("sync status line", () => {
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

  it("keeps the composed text while syncing but marks the dot running", () => {
    expect(composeStatusLine({ ...facts, pending: 1, syncing: true }, 2_000_000)).toEqual({
      text: "已保存 · 1 条待同步",
      tone: "pending",
      dot: "sync-running",
    });
  });
});
