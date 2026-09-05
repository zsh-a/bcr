import {
  artifactStore,
  ArtifactStoreTag,
  TaskFailed,
  type ArtifactRef,
  type ArtifactStore,
  type ComputeTask,
} from "@bcr/core";
import { MemoryStore } from "@bcr/storage-opfs";
import { Cause, Context, Effect, Exit, Fiber, Layer, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { workerExecutor } from "../src/executor";
import { WorkerPool, type PoolWorker } from "../src/pool";

const outRef: ArtifactRef = {
  id: "out-1",
  type: "test/result",
  storage: "memory",
};

const task: ComputeTask = {
  id: "t1",
  runtime: "wasm",
  operation: "test.op",
  inputs: [],
  outputs: [{ type: "test/result" }],
};

type RunMessage = { type: "run"; task: ComputeTask; port: MessagePort };

/** 在进程内模拟 Worker：收到 run 后按脚本经 port 回事件。 */
class FakeWorker implements PoolWorker {
  cancelled: string[] = [];
  constructor(private readonly script: (task: ComputeTask, port: MessagePort) => void) {}
  postMessage(message: unknown): void {
    const msg = message as RunMessage | { type: "cancel"; taskId: string };
    if (msg.type === "cancel") {
      this.cancelled.push(msg.taskId);
      return;
    }
    queueMicrotask(() => this.script(msg.task, msg.port));
  }
  addEventListener(): void {}
  removeEventListener(): void {}
  terminate(): void {}
}

async function makeArtifacts(): Promise<ArtifactStore> {
  const layer = artifactStore({ memory: new MemoryStore() });
  const ctx = await Effect.runPromise(Effect.scoped(Layer.build(layer)));
  return Context.get(ctx, ArtifactStoreTag);
}

describe("WorkerExecutor (架构 §6.2)", () => {
  it("run → progress/chunk/completed，chunk 字节落入 ArtifactStore", async () => {
    const worker = new FakeWorker((t, port) => {
      port.postMessage({ type: "progress", taskId: t.id, value: 0.5 });
      port.postMessage({
        type: "chunk",
        taskId: t.id,
        artifact: outRef,
        data: new Uint8Array([1, 2, 3]),
      });
      port.postMessage({
        type: "completed",
        taskId: t.id,
        outputs: [outRef],
        cacheable: false,
      });
    });
    const pool = new WorkerPool(1, () => worker);
    const artifacts = await makeArtifacts();
    const executor = workerExecutor(pool, "wasm", "v1", artifacts, ["test.op"]);

    const events = await Effect.runPromise(Stream.runCollect(executor.run(task)));
    const collected = [...events];

    expect(collected.map((e) => e.type)).toEqual(["progress", "chunk", "completed"]);
    expect(collected[2]).toMatchObject({ type: "completed", cacheable: false });
    const data = await Effect.runPromise(artifacts.get(outRef));
    expect([...data]).toEqual([1, 2, 3]);
    pool.shutdown();
  });

  it("failed 事件 → 流以 TaskFailed 失败", async () => {
    const worker = new FakeWorker((t, port) => {
      port.postMessage({ type: "failed", taskId: t.id, error: "boom" });
    });
    const pool = new WorkerPool(1, () => worker);
    const executor = workerExecutor(pool, "wasm", "v1", await makeArtifacts(), ["test.op"]);

    const exit = await Effect.runPromise(Effect.exit(Stream.runCollect(executor.run(task))));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const failure = Cause.failureOption(exit.cause);
      expect(failure._tag).toBe("Some");
      if (failure._tag === "Some") {
        expect(failure.value).toBeInstanceOf(TaskFailed);
      }
    }
    pool.shutdown();
  });

  it("中断流 → Worker 收到 cancel 命令（§6.1）", async () => {
    const worker = new FakeWorker(() => {
      // 永不回事件，等待取消
    });
    const pool = new WorkerPool(1, () => worker);
    const executor = workerExecutor(pool, "wasm", "v1", await makeArtifacts(), ["test.op"]);

    const fiber = Effect.runFork(Stream.runCollect(executor.run(task)));
    await new Promise((r) => setTimeout(r, 20));
    await Effect.runPromise(Fiber.interrupt(fiber));

    expect(worker.cancelled).toContain("t1");
    pool.shutdown();
  });

  it("等待 Worker 时中断会撤销 acquire，不泄漏池容量", async () => {
    const worker = new FakeWorker(() => {
      // 两个任务都保持运行，测试显式中断。
    });
    const pool = new WorkerPool(1, () => worker);
    const executor = workerExecutor(pool, "wasm", "v1", await makeArtifacts(), ["test.op"]);
    const waitingTask = { ...task, id: "t2" };

    const running = Effect.runFork(Stream.runCollect(executor.run(task)));
    await new Promise((resolve) => setTimeout(resolve, 10));
    const waiting = Effect.runFork(Stream.runCollect(executor.run(waitingTask)));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(pool.snapshot).toMatchObject({ busy: 1, queued: 1 });

    await Effect.runPromise(Fiber.interrupt(waiting));
    expect(pool.snapshot.queued).toBe(0);
    expect(worker.cancelled).not.toContain("t2");

    await Effect.runPromise(Fiber.interrupt(running));
    expect(pool.snapshot).toMatchObject({ idle: 1, busy: 0, queued: 0 });
    expect(worker.cancelled).toContain("t1");
    pool.shutdown();
  });

  it("Pool 已关闭时 executor 以 TaskFailed 明确失败", async () => {
    const pool = new WorkerPool(1, () => new FakeWorker(() => undefined));
    pool.shutdown();
    const executor = workerExecutor(pool, "wasm", "v1", await makeArtifacts(), ["test.op"]);

    const exit = await Effect.runPromise(Effect.exit(Stream.runCollect(executor.run(task))));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const failure = Cause.failureOption(exit.cause);
      expect(failure._tag).toBe("Some");
      if (failure._tag === "Some") {
        expect(failure.value).toMatchObject({
          _tag: "TaskFailed",
          taskId: "t1",
          message: "worker pool is closed",
        });
      }
    }
  });
});
