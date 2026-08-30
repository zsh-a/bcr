import { describe, expect, it } from "vitest";
import { ownedChunks, planSampleWindows } from "../src/windows";

describe("planSampleWindows", () => {
  it("短音频：单窗口覆盖全部，无 stride 延伸", () => {
    const windows = planSampleWindows(16000 * 30, 16000 * 120, 16000 * 4);
    expect(windows).toEqual([{ start: 0, end: 16000 * 30, ownEnd: 16000 * 30 }]);
  });

  it("长音频：窗口滑动，own 区间无缝平铺，末窗收缩到总数", () => {
    const rate = 16000;
    const win = rate * 120;
    const stride = rate * 4;
    const total = rate * 250; // 2 个整窗 + 10s 余量
    const windows = planSampleWindows(total, win, stride);

    expect(windows.length).toBe(3);
    // own 区间无缝覆盖 [0, total)
    expect(windows[0]?.start).toBe(0);
    expect(windows[0]?.ownEnd).toBe(win);
    expect(windows[1]?.start).toBe(win);
    expect(windows[1]?.ownEnd).toBe(win * 2);
    // 非末窗：end 延伸 stride
    expect(windows[0]?.end).toBe(win + stride);
    // 末窗：start 之后不足一窗，own 与 end 都收到 total
    expect(windows[2]?.start).toBe(win * 2);
    expect(windows[2]?.ownEnd).toBe(total);
    expect(windows[2]?.end).toBe(total);
  });

  it("边界：空音频与非法窗口", () => {
    expect(planSampleWindows(0, 1000, 100)).toEqual([]);
    expect(planSampleWindows(1000, 0, 100)).toEqual([]);
  });
});

describe("ownedChunks", () => {
  const chunks = [
    { start: 0.5, text: "a" },
    { start: 119.9, text: "b" }, // 窗 0 拥有
    { start: 120.1, text: "c" }, // stride 区间 → 窗 1 拥有
    { start: 121.0, text: "d" },
  ];

  it("按 start 归属窗口，stride 区间让渡给下一窗", () => {
    expect(ownedChunks(chunks, 0, 120).map((c) => c.text)).toEqual(["a", "b"]);
    expect(ownedChunks(chunks, 120, 240).map((c) => c.text)).toEqual(["c", "d"]);
  });
});
