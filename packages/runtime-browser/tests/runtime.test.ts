import {
  createRuntimeHost,
  resourceManagerLive,
  ResourceManagerTag,
  type ComputeTask,
  type RuntimeExecutor,
} from "@bcr/core";
import { MemoryStore } from "@bcr/storage-opfs";
import type { SqliteDb } from "@bcr/storage-sqlite";
import { Context, Effect, Exit, Layer, Stream } from "effect";
import { describe, expect, it, vi } from "vitest";
import { createBrowserRuntime } from "../src";

const task = (id: string): ComputeTask => ({
  id,
  operation: "wait",
  runtime: "js",
  inputs: [],
  outputs: [],
  cache: { enabled: false },
});
const executor: RuntimeExecutor = {
  operations: ["wait"],
  runtime: "js",
  version: "1",
  run: () => Stream.fromEffect(Effect.never),
};

describe("browser runtime ownership", () => {
  it("shares one budget across isolated sessions and releases it on disposal", async () => {
    const context = await Effect.runPromise(
      Effect.scoped(Layer.build(resourceManagerLive({ memoryMB: 1024, threads: 1, gpuSlots: 1 }))),
    );
    const host = createRuntimeHost(Context.get(context, ResourceManagerTag));
    const closes = vi.fn();
    const create = (namespace: string) =>
      createBrowserRuntime({
        namespace,
        host,
        store: new MemoryStore(),
        openMetadata: async () => {
          throw new Error("test memory metadata");
        },
        execution: () => ({ executors: [executor], dispose: closes }),
      });
    const first = await create("one");
    const second = await create("two");
    try {
      expect(first.artifacts).not.toBe(second.artifacts);
      const a = await Effect.runPromise(first.scheduler.submit(task("a")));
      const b = await Effect.runPromise(second.scheduler.submit(task("b")));
      await vi.waitFor(() => {
        expect(a.state.getSnapshot().status).toBe("running");
        expect(b.state.getSnapshot().status).toBe("queued");
      });
      await first.dispose();
      await vi.waitFor(() => expect(b.state.getSnapshot().status).toBe("running"));
      expect(a.state.getSnapshot().status).toBe("cancelled");
      expect(host.sessions()).toEqual([second]);
      await host.dispose();
      await host.dispose();
      expect(b.state.getSnapshot().status).toBe("cancelled");
      expect((await Effect.runPromise(host.resources.snapshot)).used.threads).toBe(0);
      expect(
        Exit.isFailure(await Effect.runPromise(Effect.exit(second.scheduler.submit(task("late"))))),
      ).toBe(true);
      expect(closes).toHaveBeenCalledTimes(2);
    } finally {
      await host.dispose();
    }
  });

  it("cleans up execution and metadata when assembly fails", async () => {
    const close = vi.fn(async () => undefined);
    const stop = vi.fn();
    const db: SqliteDb = {
      close,
      persist: async () => undefined,
      run: () => undefined,
      all: () => [],
      value: () => undefined,
      kvGet: async () => undefined,
      kvSet: async () => undefined,
    };
    await expect(
      createBrowserRuntime({
        namespace: "broken",
        store: new MemoryStore(),
        openMetadata: async () => db,
        execution: () => ({ executors: [executor, executor], dispose: stop }),
      }),
    ).rejects.toThrow("Duplicate executor");
    expect(close).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
