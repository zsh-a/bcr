import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { decodeWorkerCommand, decodeWorkerEvent } from "../src/protocol";

describe("protocol (架构 §6.2)", () => {
  it("run / cancel 命令 round-trip", () => {
    const run = decodeWorkerCommand({
      type: "run",
      task: {
        id: "t1",
        runtime: "wasm",
        operation: "hash.blake3",
        inputs: [],
        outputs: [{ type: "hash/hex" }],
      },
    });
    expect(Either.isRight(run)).toBe(true);

    const cancel = decodeWorkerCommand({ type: "cancel", taskId: "t1" });
    expect(Either.isRight(cancel)).toBe(true);
  });

  it("事件 round-trip", () => {
    for (const event of [
      { type: "progress", taskId: "t1", value: 0.5 },
      {
        type: "chunk",
        taskId: "t1",
        artifact: { id: "a1", type: "audio/pcm-f32", storage: "memory" },
      },
      {
        type: "completed",
        taskId: "t1",
        outputs: [{ id: "a1", type: "audio/pcm-f32", storage: "memory" }],
      },
      { type: "failed", taskId: "t1", error: "boom" },
    ]) {
      expect(Either.isRight(decodeWorkerEvent(event))).toBe(true);
    }
  });

  it("非法消息被拒绝（容错边界）", () => {
    expect(Either.isLeft(decodeWorkerEvent({ type: "bogus" }))).toBe(true);
    expect(Either.isLeft(decodeWorkerCommand({ type: "run" }))).toBe(true);
    expect(Either.isLeft(decodeWorkerEvent(null))).toBe(true);
  });
});
