import { MemoryStore } from "@bcr/storage-opfs";
import { Cause, Effect, Exit, Layer, Schedule, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { artifactPath, artifactStore } from "../src/artifact";
import { memoryCacheStore } from "../src/cache-store";
import { TaskFailed } from "../src/errors";
import { executorRegistry, Executors, type RuntimeExecutor } from "../src/executor";
import type { ResourceCapacity } from "../src/resource-manager";
import type { ArtifactRef, ComputeTask, TaskEvent } from "../src/schema";
import {
  schedulerLive,
  schedulerLiveWithCapacity,
  SchedulerTag,
  type Scheduler,
} from "../src/scheduler";

const ref = (id: string, hash?: string): ArtifactRef => ({
  id,
  type: "test/data",
  storage: "memory",
  ...(hash !== undefined ? { hash } : {}),
});

const task = (id: string, inputs: ArtifactRef[] = []): ComputeTask => ({
  id,
  runtime: "js",
  operation: "test.op",
  inputs,
  outputs: [{ type: "test/result" }],
});

const completed = (taskId: string, outputs: ArtifactRef[]): TaskEvent => ({
  type: "completed",
  taskId,
  outputs,
});

const progress = (taskId: string, value: number): TaskEvent => ({
  type: "progress",
  taskId,
  value,
});

function countingExecutor(behavior?: (task: ComputeTask) => Stream.Stream<TaskEvent, TaskFailed>) {
  let runs = 0;
  const executor: RuntimeExecutor = {
    runtime: "js",
    version: "test-1",
    run: (t) => {
      runs += 1;
      if (behavior !== undefined) return behavior(t);
      return Stream.make(
        progress(t.id, 0.5),
        completed(t.id, [ref(`out-${t.id}`, `hash-${t.id}`)]),
      );
    },
  };
  return { executor, runs: () => runs };
}

function makeRuntime(executor: RuntimeExecutor, capacity?: ResourceCapacity) {
  const binary = new MemoryStore();
  // RuntimeExecutor 的契约要求 completed 前已物化输出；测试执行器在此补齐该行为。
  const materializing: RuntimeExecutor = {
    ...executor,
    run: (t) =>
      executor.run(t).pipe(
        Stream.tap((event) =>
          event.type === "completed"
            ? Effect.promise(async () => {
                for (const output of event.outputs) {
                  await binary.put(artifactPath(output), new Uint8Array());
                }
              })
            : Effect.void,
        ),
      ),
  };
  const deps = Layer.mergeAll(
    artifactStore({ memory: binary }),
    memoryCacheStore(),
    Layer.succeed(Executors, executorRegistry([materializing])),
  );
  const live = Layer.provideMerge(
    capacity === undefined ? schedulerLive : schedulerLiveWithCapacity(capacity),
    deps,
  );
  return {
    live,
    binary,
    run: <A, E>(effect: Effect.Effect<A, E, SchedulerTag>) =>
      Effect.runPromise(effect.pipe(Effect.provide(live))),
    withScheduler: <A, E>(f: (s: Scheduler) => Effect.Effect<A, E>) =>
      Effect.runPromise(Effect.flatMap(SchedulerTag, f).pipe(Effect.provide(live))),
  };
}

describe("Scheduler (架构 §2/§3/§6/§7)", () => {
  it("成功路径：progress + completed，await 返回输出", async () => {
    const { executor } = countingExecutor();
    const { withScheduler } = makeRuntime(executor);

    const result = await withScheduler((s) =>
      Effect.gen(function* () {
        const handle = yield* s.submit(task("t1"));
        const events = yield* Stream.runCollect(handle.events);
        const outputs = yield* handle.await;
        return { events: [...events], outputs };
      }),
    );

    expect(result.events.map((e) => e.type)).toEqual(["progress", "completed"]);
    expect(result.outputs[0]?.id).toBe("out-t1");
  });

  it("缓存命中：相同输入重跑不重算（§7）", async () => {
    const { executor, runs } = countingExecutor();
    const { withScheduler } = makeRuntime(executor);
    const input = ref("in-1", "hash-in-1");

    const { first, second } = await withScheduler((s) =>
      Effect.gen(function* () {
        const h1 = yield* s.submit(task("t1", [input]));
        const first = yield* h1.await;
        const h2 = yield* s.submit(task("t2", [input]));
        const second = yield* h2.await;
        return { first, second };
      }),
    );

    expect(runs()).toBe(1);
    expect(second).toEqual(first);
  });

  it("输入 hash 变化 → 缓存失效重算", async () => {
    const { executor, runs } = countingExecutor();
    const { withScheduler } = makeRuntime(executor);

    await withScheduler((s) =>
      Effect.gen(function* () {
        const h1 = yield* s.submit(task("t1", [ref("in-1", "v1")]));
        yield* h1.await;
        const h2 = yield* s.submit(task("t2", [ref("in-1", "v2")]));
        yield* h2.await;
      }),
    );

    expect(runs()).toBe(2);
  });

  it("缓存引用的产物缺失 → 驱逐陈旧条目并重算", async () => {
    const { executor, runs } = countingExecutor();
    const { withScheduler, binary } = makeRuntime(executor);
    const input = ref("in-1", "hash-in-1");

    await withScheduler((s) =>
      Effect.gen(function* () {
        const first = yield* s.submit(task("t1", [input]));
        const outputs = yield* first.await;
        const output = outputs[0];
        if (output !== undefined) yield* Effect.promise(() => binary.delete(artifactPath(output)));

        const second = yield* s.submit(task("t2", [input]));
        expect(second.cached).toBe(false);
        yield* second.await;
      }),
    );

    expect(runs()).toBe(2);
  });

  it("executor 标记 cacheable=false → 后续提交不会命中", async () => {
    const { executor, runs } = countingExecutor((t) =>
      Stream.make({ ...completed(t.id, [ref(`out-${t.id}`, `h-${t.id}`)]), cacheable: false }),
    );
    const { withScheduler } = makeRuntime(executor);
    const input = ref("in-1", "hash-in-1");

    await withScheduler((s) =>
      Effect.gen(function* () {
        const first = yield* s.submit(task("t1", [input]));
        yield* first.await;
        const second = yield* s.submit(task("t2", [input]));
        expect(second.cached).toBe(false);
        yield* second.await;
      }),
    );

    expect(runs()).toBe(2);
  });

  it("资源预算：内存不足时 FIFO 排队，后来的小任务不能插队", async () => {
    const starts: string[] = [];
    let active = 0;
    let maxActive = 0;
    const { executor } = countingExecutor((current) => {
      starts.push(current.id);
      active += 1;
      maxActive = Math.max(maxActive, active);
      return Stream.fromEffect(
        Effect.sleep("30 millis").pipe(
          Effect.tap(() => Effect.sync(() => (active -= 1))),
          Effect.as(completed(current.id, [ref(`out-${current.id}`, `h-${current.id}`)])),
        ),
      );
    });
    const { withScheduler } = makeRuntime(executor, {
      memoryMB: 100,
      threads: 3,
      gpuSlots: 1,
    });

    const snapshot = await withScheduler((scheduler) =>
      Effect.gen(function* () {
        const first = yield* scheduler.submit({
          ...task("first"),
          resources: { memoryMB: 60 },
        });
        yield* Effect.sleep("5 millis");
        const large = yield* scheduler.submit({
          ...task("large"),
          resources: { memoryMB: 100 },
        });
        const small = yield* scheduler.submit({
          ...task("small"),
          resources: { memoryMB: 40 },
        });
        yield* Effect.sleep("5 millis");
        const snapshot = yield* scheduler.resourceSnapshot;
        yield* Effect.all([first.await, large.await, small.await], { concurrency: "unbounded" });
        return snapshot;
      }),
    );

    expect(snapshot.used.memoryMB).toBe(60);
    expect(snapshot.queued.map((entry) => entry.taskId)).toEqual(["large", "small"]);
    expect(starts).toEqual(["first", "large", "small"]);
    expect(maxActive).toBe(1);
  });

  it("取消排队任务会移出资源队列并让后续任务继续", async () => {
    const starts: string[] = [];
    const { executor } = countingExecutor((current) => {
      starts.push(current.id);
      return Stream.fromEffect(
        Effect.sleep("30 millis").pipe(
          Effect.as(completed(current.id, [ref(`out-${current.id}`, `h-${current.id}`)])),
        ),
      );
    });
    const { withScheduler } = makeRuntime(executor, {
      memoryMB: 100,
      threads: 1,
      gpuSlots: 1,
    });

    const queuedExit = await withScheduler((scheduler) =>
      Effect.gen(function* () {
        const running = yield* scheduler.submit(task("running"));
        yield* Effect.sleep("5 millis");
        const cancelled = yield* scheduler.submit(task("cancelled"));
        const next = yield* scheduler.submit(task("next"));
        yield* cancelled.cancel;
        const exit = yield* Effect.exit(cancelled.await);
        yield* Effect.all([running.await, next.await], { concurrency: "unbounded" });
        return exit;
      }),
    );

    expect(Exit.isInterrupted(queuedExit)).toBe(true);
    expect(starts).toEqual(["running", "next"]);
  });

  it("取消运行中任务会归还 lease 并唤醒队首", async () => {
    const starts: string[] = [];
    const { executor } = countingExecutor((current) => {
      starts.push(current.id);
      return current.id === "running"
        ? Stream.never
        : Stream.make(completed(current.id, [ref(`out-${current.id}`, `h-${current.id}`)]));
    });
    const { withScheduler } = makeRuntime(executor, {
      memoryMB: 100,
      threads: 1,
      gpuSlots: 1,
    });

    const runningExit = await withScheduler((scheduler) =>
      Effect.gen(function* () {
        const running = yield* scheduler.submit(task("running"));
        yield* Effect.sleep("5 millis");
        const next = yield* scheduler.submit(task("next"));
        yield* Effect.sleep("5 millis");
        yield* running.cancel;
        const exit = yield* Effect.exit(running.await);
        yield* next.await;
        return exit;
      }),
    );

    expect(Exit.isInterrupted(runningExit)).toBe(true);
    expect(starts).toEqual(["running", "next"]);
  });

  it("单任务请求超过总容量时快速失败；缓存命中不占用资源", async () => {
    const { executor, runs } = countingExecutor();
    const { withScheduler } = makeRuntime(executor, {
      memoryMB: 64,
      threads: 1,
      gpuSlots: 0,
    });
    const input = ref("source", "same-content");

    const oversized = await withScheduler((scheduler) =>
      Effect.gen(function* () {
        const first = yield* scheduler.submit({
          ...task("first", [input]),
          config: { mode: "ok" },
        });
        yield* first.await;
        const cached = yield* scheduler.submit({
          ...task("cached", [input]),
          config: { mode: "ok" },
          resources: { memoryMB: 999, threads: 99, gpu: true },
        });
        expect(cached.cached).toBe(true);
        yield* cached.await;

        const rejected = yield* scheduler.submit({
          ...task("rejected", [input]),
          config: { mode: "different" },
          resources: { memoryMB: 65 },
        });
        return yield* Effect.exit(rejected.await);
      }),
    );

    expect(runs()).toBe(1);
    expect(Exit.isFailure(oversized)).toBe(true);
    if (Exit.isFailure(oversized)) {
      const error = Cause.failureOption(oversized.cause);
      expect(error._tag).toBe("Some");
      if (error._tag === "Some" && error.value instanceof TaskFailed) {
        expect(error.value.message).toContain("resource request exceeds capacity");
      }
    }
  });

  it("取消级联：取消上游 → 下游运行中任务被中断（§3）", async () => {
    const { executor } = countingExecutor((t) =>
      t.id === "upstream"
        ? Stream.make(completed(t.id, [ref("out-upstream", "h-up")]))
        : Stream.never.pipe(
            Stream.concat(Stream.make(completed(t.id, [ref("out-down", "h-down")]))),
          ),
    );
    const { withScheduler } = makeRuntime(executor);

    const downExit = await withScheduler((s) =>
      Effect.gen(function* () {
        const up = yield* s.submit(task("upstream"));
        yield* up.await;

        const down = yield* s.submit(task("downstream", [ref("out-upstream", "h-up")]));
        // 等下游任务进入 executor
        yield* Effect.sleep("50 millis");
        yield* s.cancel("upstream");

        return yield* Effect.exit(down.await);
      }),
    );

    expect(Exit.isInterrupted(downExit)).toBe(true);
  });

  it("timeout：超时后任务失败（§6.1）", async () => {
    const { executor } = countingExecutor(() => Stream.never);
    const { withScheduler } = makeRuntime(executor);

    const exit = await withScheduler((s) =>
      Effect.gen(function* () {
        const handle = yield* s.submit(task("t1"), { timeout: "50 millis" });
        return yield* Effect.exit(handle.await);
      }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const error = Cause.failureOption(exit.cause);
      expect(error._tag).toBe("Some");
      if (error._tag === "Some") {
        expect(error.value).toBeInstanceOf(TaskFailed);
      }
    }
  });

  it("retry：失败后按 Schedule 重试", async () => {
    let attempts = 0;
    const { executor } = countingExecutor((t) => {
      attempts += 1;
      if (attempts === 1) {
        return Stream.fail(new TaskFailed({ taskId: t.id, message: "boom" }));
      }
      return Stream.make(completed(t.id, [ref("out-t1", "h")]));
    });
    const { withScheduler } = makeRuntime(executor);

    const outputs = await withScheduler((s) =>
      Effect.gen(function* () {
        const handle = yield* s.submit(task("t1"), {
          retry: Schedule.recurs(1),
        });
        return yield* handle.await;
      }),
    );

    expect(attempts).toBe(2);
    expect(outputs[0]?.id).toBe("out-t1");
  });

  it("invalidateArtifact：仅失效下游链路，上游缓存保留（§3）", async () => {
    const { executor, runs } = countingExecutor((t) =>
      Stream.make(completed(t.id, [ref(`out-${t.id}`, `h-${t.id}`)])),
    );
    const { withScheduler } = makeRuntime(executor);

    await withScheduler((s) =>
      Effect.gen(function* () {
        const source = ref("source", "h-source");
        const a = yield* s.submit(task("A", [source]));
        yield* a.await;
        const b = yield* s.submit(task("B", [ref("out-A", "h-A")]));
        yield* b.await;

        // 用户删除源数据 → 下游全部失效
        yield* s.invalidateArtifact("source");

        // 重跑 A 与 B：都应重算（A 消费 source）
        const a2 = yield* s.submit(task("A2", [source]));
        yield* a2.await;
        const b2 = yield* s.submit(task("B2", [ref("out-A2", "h-A2")]));
        yield* b2.await;
      }),
    );

    expect(runs()).toBe(4);
  });

  it("修改下游参数：上游缓存命中，仅下游重算（§3 场景二）", async () => {
    const { executor, runs } = countingExecutor((t) =>
      Stream.make(completed(t.id, [ref(`out-${t.id}-${String(t.config?.["v"])}`, "h")])),
    );
    const { withScheduler } = makeRuntime(executor);
    const source = ref("source", "h-source");

    await withScheduler((s) =>
      Effect.gen(function* () {
        const a1 = yield* s.submit(task("A1", [source]));
        yield* a1.await;
        const b1 = yield* s.submit({
          ...task("B1", [ref("out-A1", "h")]),
          config: { v: 1 },
        });
        yield* b1.await;

        // 只改下游参数：A2 命中缓存，B2 重算
        const a2 = yield* s.submit(task("A2", [source]));
        yield* a2.await;
        const b2 = yield* s.submit({
          ...task("B2", [ref("out-A1", "h")]),
          config: { v: 2 },
        });
        yield* b2.await;
      }),
    );

    // A 只算 1 次，B 算 2 次
    expect(runs()).toBe(3);
  });

  it("未知 runtime → NoExecutor", async () => {
    const { executor } = countingExecutor();
    const { live } = makeRuntime(executor);

    const exit = await Effect.runPromise(
      Effect.exit(
        Effect.flatMap(SchedulerTag, (s) => s.submit({ ...task("t1"), runtime: "webgpu" })),
      ).pipe(Effect.provide(live)),
    );

    expect(Exit.isFailure(exit)).toBe(true);
  });

  it("事件流对外暴露 failed 事件", async () => {
    const { executor } = countingExecutor((t) =>
      Stream.fail(new TaskFailed({ taskId: t.id, message: "boom" })),
    );
    const { withScheduler } = makeRuntime(executor);

    const events = await withScheduler((s) =>
      Effect.gen(function* () {
        const handle = yield* s.submit(task("t1"));
        const collected = yield* Stream.runCollect(handle.events);
        return [...collected];
      }),
    );

    expect(events).toEqual([{ type: "failed", taskId: "t1", error: "boom" }]);
  });
});
