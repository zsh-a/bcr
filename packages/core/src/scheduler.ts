import { Context, Duration, Effect, Fiber, Layer, PubSub, Schedule, Stream } from "effect";
import { ArtifactStoreTag } from "./artifact";
import { cacheKey } from "./cache-key";
import { CacheStoreTag } from "./cache-store";
import { NoExecutor, TaskFailed, type SchedulerError } from "./errors";
import { Executors, type RuntimeExecutor } from "./executor";
import type { ArtifactRef, ComputeTask, TaskEvent } from "./schema";

export interface SubmitOptions {
  /** 超时后任务以 TaskFailed("timeout") 失败。 */
  readonly timeout?: Duration.DurationInput | undefined;
  /** 重试策略（§6.1：retry 由 Schedule 承载）。 */
  readonly retry?: Schedule.Schedule<unknown, SchedulerError> | undefined;
}

export interface TaskHandle {
  readonly taskId: string;
  /** 多播事件流；completed / failed / cancel 后结束。 */
  readonly events: Stream.Stream<TaskEvent>;
  /** 等待最终输出 ArtifactRef 列表。 */
  readonly await: Effect.Effect<ReadonlyArray<ArtifactRef>, SchedulerError>;
  /** 取消本任务，并级联取消下游依赖任务（§3）。 */
  readonly cancel: Effect.Effect<void>;
  /** 结果是否来自缓存命中（§7），未实际执行。 */
  readonly cached: boolean;
}

export interface Scheduler {
  readonly submit: (
    task: ComputeTask,
    options?: SubmitOptions,
  ) => Effect.Effect<TaskHandle, NoExecutor>;
  readonly cancel: (taskId: string) => Effect.Effect<void>;
  /**
   * 架构文档 §3：源数据变更/删除 → 仅失效下游链路。
   * 取消正在运行的下游任务、清掉下游缓存条目。
   */
  readonly invalidateArtifact: (artifactId: string) => Effect.Effect<void>;
}

export class SchedulerTag extends Context.Tag("bcr/Scheduler")<SchedulerTag, Scheduler>() {}

type TaskFiber = Fiber.RuntimeFiber<ReadonlyArray<ArtifactRef>, SchedulerError>;

export const schedulerLive: Layer.Layer<
  SchedulerTag,
  never,
  ArtifactStoreTag | CacheStoreTag | Executors
> = Layer.effect(
  SchedulerTag,
  Effect.gen(function* () {
    const artifacts = yield* ArtifactStoreTag;
    const cache = yield* CacheStoreTag;
    const executors = yield* Executors;

    const running = new Map<string, TaskFiber>();
    const cacheKeys = new Map<string, string | undefined>();

    const keyFor = (task: ComputeTask, executor: RuntimeExecutor): string | undefined => {
      if (task.cache !== undefined && !task.cache.enabled) return undefined;
      if (task.cache?.key !== undefined) return task.cache.key;
      return cacheKey({
        operation: task.operation,
        inputs: task.inputs,
        config: task.config,
        runtimeVersion: executor.version,
      });
    };

    const cancelCascade = (taskId: string, visited: Set<string>): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (visited.has(taskId)) return;
        visited.add(taskId);

        const fiber = running.get(taskId);
        if (fiber !== undefined) {
          yield* Fiber.interrupt(fiber);
        }
        running.delete(taskId);

        const key = cacheKeys.get(taskId);
        if (key !== undefined) {
          yield* cache.remove(key);
        }
        cacheKeys.delete(taskId);

        const outs = yield* artifacts.outputsOf(taskId);
        for (const artifactId of outs) {
          const consumers = yield* artifacts.consumersOf(artifactId);
          for (const consumerId of consumers) {
            yield* cancelCascade(consumerId, visited);
          }
        }
      });

    const submit = (
      task: ComputeTask,
      options: SubmitOptions = {},
    ): Effect.Effect<TaskHandle, NoExecutor> =>
      Effect.gen(function* () {
        const executor = executors.get(task.runtime);
        if (executor === undefined) {
          return yield* new NoExecutor({ runtime: task.runtime });
        }

        const key = keyFor(task, executor);
        cacheKeys.set(task.id, key);
        yield* artifacts.registerConsumption(task);

        // §7：缓存命中 → 不重算，直接产出缓存的 ArtifactRef。
        if (key !== undefined) {
          const cached = yield* cache.get(key);
          if (cached !== undefined) {
            yield* artifacts.registerProduction(task.id, cached);
            return {
              taskId: task.id,
              events: Stream.succeed<TaskEvent>({
                type: "completed",
                taskId: task.id,
                outputs: [...cached],
              }),
              await: Effect.succeed(cached),
              cancel: Effect.void,
              cached: true,
            };
          }
        }

        const pubsub = yield* PubSub.unbounded<TaskEvent>();

        let program: Effect.Effect<ReadonlyArray<ArtifactRef>, SchedulerError> = Effect.gen(
          function* () {
            const events = executor.run(task);
            let outputs: ReadonlyArray<ArtifactRef> | undefined;
            yield* events.pipe(
              Stream.runForEach((event) =>
                Effect.gen(function* () {
                  yield* PubSub.publish(pubsub, event);
                  if (event.type === "completed") {
                    outputs = event.outputs;
                  }
                }),
              ),
            );
            if (outputs === undefined) {
              return yield* new TaskFailed({
                taskId: task.id,
                message: "executor stream ended without a completed event",
              });
            }
            yield* artifacts.registerProduction(task.id, outputs);
            if (key !== undefined) {
              yield* cache.put(key, outputs);
            }
            return outputs;
          },
        );

        if (options.retry !== undefined) {
          program = Effect.retry(program, options.retry);
        }
        if (options.timeout !== undefined) {
          program = Effect.timeoutFail(program, {
            duration: options.timeout,
            onTimeout: () => new TaskFailed({ taskId: task.id, message: "timeout" }),
          });
        }

        program = program.pipe(
          Effect.tapError((error) =>
            PubSub.publish(pubsub, {
              type: "failed",
              taskId: task.id,
              error: error.message,
            }),
          ),
          Effect.onInterrupt(() =>
            PubSub.publish(pubsub, {
              type: "failed",
              taskId: task.id,
              error: "cancelled",
            }),
          ),
          Effect.ensuring(
            Effect.gen(function* () {
              running.delete(task.id);
              yield* PubSub.shutdown(pubsub);
            }),
          ),
        );

        const fiber: TaskFiber = yield* Effect.forkDaemon(program);
        running.set(task.id, fiber);

        return {
          taskId: task.id,
          events: Stream.fromPubSub(pubsub),
          await: Fiber.join(fiber),
          cancel: cancelCascade(task.id, new Set()),
          cached: false,
        };
      });

    const invalidateArtifact = (artifactId: string): Effect.Effect<void> =>
      Effect.gen(function* () {
        const visitedTasks = new Set<string>();
        const visitedArtifacts = new Set<string>();

        const go = (id: string): Effect.Effect<void> =>
          Effect.gen(function* () {
            if (visitedArtifacts.has(id)) return;
            visitedArtifacts.add(id);
            const consumers = yield* artifacts.consumersOf(id);
            for (const taskId of consumers) {
              yield* cancelCascade(taskId, visitedTasks);
              const outs = yield* artifacts.outputsOf(taskId);
              for (const out of outs) {
                yield* go(out);
              }
            }
          });

        yield* go(artifactId);
      });

    return {
      submit,
      cancel: (taskId) => cancelCascade(taskId, new Set()),
      invalidateArtifact,
    };
  }),
);
