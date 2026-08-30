import { MemoryStore } from "@bcr/storage-opfs";
import { Cause, Effect, Exit, Layer, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { artifactStore } from "../src/artifact";
import { memoryCacheStore } from "../src/cache-store";
import { InvalidPipeline, TaskFailed } from "../src/errors";
import { executorRegistry, Executors, type RuntimeExecutor } from "../src/executor";
import type { ComputeTask, TaskEvent } from "../src/schema";
import { schedulerLive, SchedulerTag, type Scheduler } from "../src/scheduler";

const completedOutputs = (taskId: string): TaskEvent => ({
  type: "completed",
  taskId,
  outputs: [{ id: `out-${taskId}`, type: "test/result", storage: "memory", hash: `h-${taskId}` }],
});

/**
 * 行为可控的 executor：每个任务产出 `out-<taskId>`；
 * behavior 可按 taskId 覆盖（含记录 inputs 供断言）。
 */
function makeExecutor(behavior?: (task: ComputeTask) => Stream.Stream<TaskEvent, TaskFailed>) {
  const runs: string[] = [];
  const inputsOf = new Map<string, ComputeTask["inputs"]>();
  const executor: RuntimeExecutor = {
    runtime: "js",
    version: "test-1",
    run: (t) => {
      runs.push(t.id);
      inputsOf.set(t.id, t.inputs);
      if (behavior !== undefined) return behavior(t);
      return Stream.make(completedOutputs(t.id));
    },
  };
  return { executor, runs: () => runs, inputsOf };
}

function makeRuntime(executor: RuntimeExecutor) {
  const deps = Layer.mergeAll(
    artifactStore({ memory: new MemoryStore() }),
    memoryCacheStore(),
    Layer.succeed(Executors, executorRegistry([executor])),
  );
  const live = Layer.provideMerge(schedulerLive, deps);
  return {
    withScheduler: <A, E>(f: (s: Scheduler) => Effect.Effect<A, E>) =>
      Effect.runPromise(Effect.flatMap(SchedulerTag, f).pipe(Effect.provide(live))),
  };
}

describe("Scheduler.submitPipeline (架构 §3 DAG 正向编排)", () => {
  it("两级流水线：上游完成自动触发下游", async () => {
    const { executor, runs, inputsOf } = makeExecutor();
    const { withScheduler } = makeRuntime(executor);

    const result = await withScheduler((s) =>
      Effect.gen(function* () {
        const handle = yield* s.submitPipeline("pl", [
          { id: "a", runtime: "js", operation: "test.op", outputs: [{ type: "test/result" }] },
          {
            id: "b",
            runtime: "js",
            operation: "test.op",
            after: ["a"],
            outputs: [{ type: "test/result" }],
          },
        ]);
        const events = yield* Stream.runCollect(handle.events);
        const outputs = yield* handle.await;
        return { events: [...events], outputs };
      }),
    );

    expect(runs().sort()).toEqual(["pl/a", "pl/b"]);
    // 下游 inputs = 上游输出
    expect(inputsOf.get("pl/b")).toEqual([
      { id: "out-pl/a", type: "test/result", storage: "memory", hash: "h-pl/a" },
    ]);
    expect(result.outputs.get("b")?.[0]?.id).toBe("out-pl/b");
    expect(result.events.map((e) => e.type).sort()).toEqual(["completed", "completed"]);
  });

  it("fan-in：多上游输出按 after 声明顺序拼接", async () => {
    const { executor, inputsOf } = makeExecutor();
    const { withScheduler } = makeRuntime(executor);

    await withScheduler((s) =>
      Effect.gen(function* () {
        const handle = yield* s.submitPipeline("pl", [
          { id: "a", runtime: "js", operation: "test.op", outputs: [{ type: "x" }] },
          { id: "b", runtime: "js", operation: "test.op", outputs: [{ type: "x" }] },
          {
            id: "c",
            runtime: "js",
            operation: "test.op",
            after: ["a", "b"],
            outputs: [{ type: "x" }],
          },
        ]);
        return yield* handle.await;
      }),
    );

    expect(inputsOf.get("pl/c")?.map((r) => r.id)).toEqual(["out-pl/a", "out-pl/b"]);
  });

  it("菱形依赖只执行一次每个节点", async () => {
    const { executor, runs } = makeExecutor();
    const { withScheduler } = makeRuntime(executor);

    await withScheduler((s) =>
      Effect.gen(function* () {
        const handle = yield* s.submitPipeline("pl", [
          { id: "a", runtime: "js", operation: "test.op", outputs: [{ type: "x" }] },
          { id: "b", runtime: "js", operation: "test.op", after: ["a"], outputs: [{ type: "x" }] },
          { id: "c", runtime: "js", operation: "test.op", after: ["a"], outputs: [{ type: "x" }] },
          {
            id: "d",
            runtime: "js",
            operation: "test.op",
            after: ["b", "c"],
            outputs: [{ type: "x" }],
          },
        ]);
        return yield* handle.await;
      }),
    );

    expect(runs().sort()).toEqual(["pl/a", "pl/b", "pl/c", "pl/d"]);
  });

  it("失败传播：任一节点失败 → 流水线失败，未启动节点不执行", async () => {
    const { executor, runs } = makeExecutor((t) =>
      t.id === "pl/b"
        ? Stream.fail(new TaskFailed({ taskId: t.id, message: "boom" }))
        : Stream.make(completedOutputs(t.id)),
    );
    const { withScheduler } = makeRuntime(executor);

    const exit = await withScheduler((s) =>
      Effect.gen(function* () {
        const handle = yield* s.submitPipeline("pl", [
          { id: "a", runtime: "js", operation: "test.op", outputs: [{ type: "x" }] },
          { id: "b", runtime: "js", operation: "test.op", after: ["a"], outputs: [{ type: "x" }] },
          {
            id: "c",
            runtime: "js",
            operation: "test.op",
            after: ["b"],
            outputs: [{ type: "x" }],
          },
        ]);
        return yield* Effect.exit(handle.await);
      }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const error = Cause.failureOption(exit.cause);
      expect(error._tag).toBe("Some");
      if (error._tag === "Some" && error.value instanceof TaskFailed) {
        expect(error.value.message).toBe("boom");
      }
    }
    expect(runs()).not.toContain("pl/c");
  });

  it("取消：handle.cancel 中断运行中节点", async () => {
    const { executor, runs } = makeExecutor((t) =>
      t.id === "pl/a"
        ? Stream.never.pipe(Stream.concat(Stream.make(completedOutputs(t.id))))
        : Stream.make(completedOutputs(t.id)),
    );
    const { withScheduler } = makeRuntime(executor);

    const exit = await withScheduler((s) =>
      Effect.gen(function* () {
        const handle = yield* s.submitPipeline("pl", [
          { id: "a", runtime: "js", operation: "test.op", outputs: [{ type: "x" }] },
          { id: "b", runtime: "js", operation: "test.op", after: ["a"], outputs: [{ type: "x" }] },
        ]);
        yield* Effect.sleep("50 millis");
        yield* handle.cancel;
        return yield* Effect.exit(handle.await);
      }),
    );

    expect(Exit.isInterrupted(exit)).toBe(true);
    expect(runs()).toEqual(["pl/a"]);
  });

  it("重跑整条流水线：命中节点全部跳过（§7 重跑 workflow）", async () => {
    const { executor, runs } = makeExecutor();
    const { withScheduler } = makeRuntime(executor);

    await withScheduler((s) =>
      Effect.gen(function* () {
        const nodes = [
          { id: "a", runtime: "js" as const, operation: "test.op", outputs: [{ type: "x" }] },
          {
            id: "b",
            runtime: "js" as const,
            operation: "test.op",
            after: ["a"],
            outputs: [{ type: "x" }],
          },
        ];
        const h1 = yield* s.submitPipeline("p1", nodes);
        yield* h1.await;
        // 第二次提交：节点 id 不同（任务 id 随 pipelineId 变化），但输入内容相同 → 缓存命中
        const h2 = yield* s.submitPipeline("p2", nodes);
        yield* h2.await;
      }),
    );

    expect(runs().length).toBe(2);
  });

  it("图校验：重复 id / 未知依赖 / 环 → InvalidPipeline", async () => {
    const { executor } = makeExecutor();
    const { withScheduler } = makeRuntime(executor);

    const duplicate = await withScheduler((s) =>
      Effect.exit(
        s.submitPipeline("pl", [
          { id: "a", runtime: "js", operation: "test.op", outputs: [] },
          { id: "a", runtime: "js", operation: "test.op", outputs: [] },
        ]),
      ),
    );
    const unknownDep = await withScheduler((s) =>
      Effect.exit(
        s.submitPipeline("pl", [
          { id: "a", runtime: "js", operation: "test.op", after: ["ghost"], outputs: [] },
        ]),
      ),
    );
    const cycle = await withScheduler((s) =>
      Effect.exit(
        s.submitPipeline("pl", [
          {
            id: "a",
            runtime: "js",
            operation: "test.op",
            after: ["b"],
            outputs: [],
          },
          { id: "b", runtime: "js", operation: "test.op", after: ["a"], outputs: [] },
        ]),
      ),
    );

    for (const exit of [duplicate, unknownDep, cycle]) {
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = Cause.failureOption(exit.cause);
        if (error._tag === "Some") expect(error.value).toBeInstanceOf(InvalidPipeline);
      }
    }
  });
});
