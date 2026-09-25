import { describe, expect, it } from "vitest";
import { noteWhen } from "../src/knowledge/KnowledgeApp";

const day = 86_400_000;
// 固定“现在”为周三 2026-09-30 12:00 本地时间，只测日界语义。
const now = new Date(2026, 8, 30, 12, 0, 0).getTime();

describe("sidebar card dates", () => {
  it("shows relative time today and keeps the ladder to absolute dates", () => {
    expect(noteWhen(now - 30_000, now)).toBe("刚刚");
    expect(noteWhen(now - 5 * 60_000, now)).toBe("5 分钟前");
    expect(noteWhen(now - 3 * 3_600_000, now)).toBe("3 小时前");
  });

  it("falls over to 昨天 and N 天前 across the day boundary", () => {
    // 昨天深夜（不足 24 小时）仍算昨天，不回落成“小时前”。
    expect(noteWhen(new Date(2026, 8, 29, 23, 30, 0).getTime(), now)).toBe("昨天");
    expect(noteWhen(new Date(2026, 8, 28, 9, 0, 0).getTime(), now)).toBe("2 天前");
    expect(noteWhen(now - 6 * day, now)).toBe("6 天前");
  });

  it("keeps the absolute date for older notes", () => {
    expect(noteWhen(now - 7 * day, now)).toBe(new Date(now - 7 * day).toLocaleDateString());
    expect(noteWhen(0, now)).toBe("未知时间");
  });
});
