import { describe, expect, it } from "vitest";
import { cacheKey } from "../src/cache-key";

const base = {
  operation: "asr.whisper",
  inputs: [{ id: "audio/chunk-001", hash: "abc123" }],
  config: { language: "ja" },
  runtimeVersion: "whisper-small-1.0",
};

describe("cacheKey (架构 §7)", () => {
  it("相同输入得到相同 key（确定性）", () => {
    expect(cacheKey(base)).toBe(cacheKey({ ...base }));
  });

  it("config 键序不影响 key（规范化）", () => {
    const a = cacheKey({ ...base, config: { a: 1, b: 2 } });
    const b = cacheKey({ ...base, config: { b: 2, a: 1 } });
    expect(a).toBe(b);
  });

  it("输入 artifact hash 变化 → key 变化", () => {
    const other = cacheKey({
      ...base,
      inputs: [{ id: "audio/chunk-001", hash: "def456" }],
    });
    expect(other).not.toBe(cacheKey(base));
  });

  it("输入顺序属于任务语义，交换输入会改变 key", () => {
    const a = cacheKey({
      ...base,
      inputs: [
        { id: "x", hash: "1" },
        { id: "y", hash: "2" },
      ],
    });
    const b = cacheKey({
      ...base,
      inputs: [
        { id: "y", hash: "2" },
        { id: "x", hash: "1" },
      ],
    });
    expect(a).not.toBe(b);
  });

  it("端口名属于任务语义，同一内容绑定到不同端口会改变 key", () => {
    const left = cacheKey({
      ...base,
      inputs: [{ id: "x", hash: "same", port: "left" }],
    });
    const right = cacheKey({
      ...base,
      inputs: [{ id: "x", hash: "same", port: "right" }],
    });
    expect(left).not.toBe(right);
  });

  it("runtimeVersion 升级 → 旧缓存失效", () => {
    const upgraded = cacheKey({ ...base, runtimeVersion: "whisper-small-2.0" });
    expect(upgraded).not.toBe(cacheKey(base));
  });

  it("无 hash 时退化为 id 寻址", () => {
    const byId = cacheKey({ ...base, inputs: [{ id: "audio/chunk-001" }] });
    expect(byId).not.toBe(cacheKey(base));
  });
});
