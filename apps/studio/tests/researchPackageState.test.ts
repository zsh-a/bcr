import { describe, expect, it } from "vitest";
import {
  decodeVolumeTaskState,
  hasVolumeOutput,
  nextPendingVolume,
} from "../src/researchPackageState";
describe("portable package task states", () => {
  it.each([
    ["待生成", "pending"],
    ["正在生成", "interrupted"],
    ["正在保存", "interrupted"],
    ["生成失败，可重试", "failed"],
    ["已取消，可重试", "cancelled"],
    ["已触发下载，可重新生成", "downloaded"],
    ["已保存到文件", "saved"],
    ["上次操作未完成，可重试", "interrupted"],
  ])("migrates the legacy state %s", (legacy, expected) => {
    expect(decodeVolumeTaskState(legacy, 1)).toBe(expected);
  });
  it("recovers interrupted operations while keeping output states distinct", () => {
    expect(decodeVolumeTaskState("generating", 2)).toBe("interrupted");
    expect(decodeVolumeTaskState("saving", 2)).toBe("interrupted");
    expect(decodeVolumeTaskState("downloaded", 2)).toBe("downloaded");
    expect(decodeVolumeTaskState("saved", 2)).toBe("saved");
    expect(hasVolumeOutput("downloaded")).toBe(true);
    expect(nextPendingVolume({ 0: "saved", 1: "downloaded", 2: "interrupted" }, 3)).toBe(2);
    expect(nextPendingVolume({ 0: "saved", 1: "downloaded" }, 2)).toBe(0);
    expect(nextPendingVolume({}, 2)).toBe(0);
  });
  it("rejects invalid states and wrong-version representations", () => {
    for (const value of [null, 1, {}, "unknown", "toString", "__proto__", "已保存到文件"])
      expect(() => decodeVolumeTaskState(value, 2)).toThrow("状态无效");
    expect(() => decodeVolumeTaskState("saved", 1)).toThrow("状态无效");
  });
});
