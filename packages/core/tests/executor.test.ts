import { Stream } from "effect";
import { describe, expect, it } from "vitest";
import { executorRegistry, type RuntimeExecutor } from "../src/executor";

const executor = (operation: string): RuntimeExecutor => ({
  runtime: "wasm",
  operations: [operation],
  version: "1",
  run: () => Stream.empty,
});

describe("operation routing", () => {
  it("routes multiple executors with the same backend by operation", () => {
    const hash = executor("hash");
    const ocr = executor("ocr");
    const registry = executorRegistry([hash, ocr]);
    expect(registry.get({ runtime: "wasm", operation: "hash" })).toBe(hash);
    expect(registry.get({ runtime: "wasm", operation: "ocr" })).toBe(ocr);
    expect(registry.get({ runtime: "wasm", operation: "missing" })).toBeUndefined();
    expect(registry.get({ runtime: "js", operation: "hash" })).toBeUndefined();
  });
  it("rejects ambiguous routes during assembly", () => {
    expect(() => executorRegistry([executor("hash"), executor("hash")])).toThrow(
      "Duplicate executor",
    );
  });
});
