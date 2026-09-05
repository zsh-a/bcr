import {
  Cause,
  Context,
  Deferred,
  Duration,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  PubSub,
  Schedule,
  Stream,
} from "effect";
import { ArtifactStoreTag } from "./artifact";
import { cacheKey } from "./cache-key";
import {
  CacheStoreTag,
  type CachePruneOptions,
  type CachePrunePlan,
  type CachePruneResult,
} from "./cache-store";
import { InvalidPipeline, NoExecutor, TaskFailed, type SchedulerError } from "./errors";
import { Executors, type RuntimeExecutor } from "./executor";
import {
  defaultResourceCapacity,
  resourceManagerLive,
  ResourceManagerTag,
  type ResourceCapacity,
  type ResourceSnapshot,
} from "./resource-manager";
import type { ArtifactRef, ComputeTask, PipelineNode, TaskEvent, TaskJournalEntry } from "./schema";
import {
  memoryTaskJournal,
  TaskJournalTag,
  type TaskJournalPruneOptions,
  type TaskJournalPrunePlan,
  type TaskJournalPruneResult,
} from "./task-journal";
import { createTaskState, type TaskStateStore } from "./task-state";

export interface SubmitOptions {
  /** 超时后任务以 TaskFailed("timeout") 失败。 */
  readonly timeout?: Duration.DurationInput | undefined;
  /** 重试策略（§6.1：retry 由 Schedule 承载）。 */
  readonly retry?: Schedule.Schedule<unknown, SchedulerError> | undefined;
}

export interface TaskHandle {
  readonly state: TaskStateStore;
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

export interface RecoveryOptions {
  /** 默认只恢复刷新时遗留的 queued/running；显式开启后也可人工重试失败/阻塞任务。 */
  readonly includeFailed?: boolean | undefined;
  /** 恢复任务沿用普通提交的超时/重试策略。 */
  readonly submit?: SubmitOptions | undefined;
}

export interface RecoveredTask {
  readonly entry: TaskJournalEntry;
  readonly handle: TaskHandle;
}

export interface RecoverySkip {
  readonly taskId: string;
  readonly reason: string;
}

export interface RecoveryReport {
  readonly resumed: ReadonlyArray<RecoveredTask>;
  readonly skipped: ReadonlyArray<RecoverySkip>;
}

/** 流水线句柄：节点按 after 依赖编排，上游完成自动触发下游（§3）。 */
export interface PipelineHandle {
  readonly pipelineId: string;
  /** 全部节点 TaskEvent 的合并多播流；流水线终态（全部完成/失败）后结束。 */
  readonly events: Stream.Stream<TaskEvent>;
  /** 等待整条流水线：nodeId → 最终输出。任一节点失败则整体失败。 */
  readonly await: Effect.Effect<ReadonlyMap<string, ReadonlyArray<ArtifactRef>>, SchedulerError>;
  /** 取消整条流水线：所有节点级联取消。 */
  readonly cancel: Effect.Effect<void>;
}

export interface Scheduler {
  /** Stop accepting work and interrupt all owned tasks and pipelines. */
  readonly shutdown: Effect.Effect<void>;
  /** 当前资源预算、占用与 FIFO 等待队列快照（供宿主监控/诊断）。 */
  readonly resourceSnapshot: Effect.Effect<ResourceSnapshot>;
  /** 持久化任务视图，供宿主恢复 UI 和任务历史。 */
  readonly journalSnapshot: Effect.Effect<ReadonlyArray<TaskJournalEntry>>;
  readonly submit: (
    task: ComputeTask,
    options?: SubmitOptions,
  ) => Effect.Effect<TaskHandle, NoExecutor | TaskFailed>;
  /**
   * 提交一条流水线：节点图经校验（重复 id / 未知依赖 / 环）后，
   * 无依赖节点立即并行执行，其余节点在上游全部完成后以其输出实例化。
   */
  readonly submitPipeline: (
    pipelineId: string,
    nodes: ReadonlyArray<PipelineNode>,
    options?: SubmitOptions,
  ) => Effect.Effect<PipelineHandle, InvalidPipeline | NoExecutor>;
  readonly cancel: (taskId: string) => Effect.Effect<void>;
  /**
   * 重放异常退出时遗留的任务。只有输入 Artifact 仍存在才会重新提交；
   * 输入缺失的任务转为 blocked 并进入 skipped，单个坏任务不会阻断其余恢复。
   */
  readonly recoverPending: (options?: RecoveryOptions) => Effect.Effect<RecoveryReport>;
  /**
   * 架构文档 §3：源数据变更/删除 → 仅失效下游链路。
   * 取消正在运行的下游任务、清掉下游缓存条目。
   */
  readonly invalidateArtifact: (artifactId: string) => Effect.Effect<void>;
  /** 维护入口：缓存计划会自动保护当前仍在运行的任务 key。 */
  readonly planCachePrune: (options?: CachePruneOptions) => Effect.Effect<CachePrunePlan>;
  readonly reclaimCache: (
    plan: CachePrunePlan,
    options?: Pick<CachePruneOptions, "protectedKeys">,
  ) => Effect.Effect<CachePruneResult>;
  /** 维护入口：TaskJournal 的 queued/running 永远不会被选择。 */
  readonly planJournalPrune: (
    options?: TaskJournalPruneOptions,
  ) => Effect.Effect<TaskJournalPrunePlan>;
  readonly reclaimJournal: (
    plan: TaskJournalPrunePlan,
    options?: Pick<TaskJournalPruneOptions, "protectedTaskIds">,
  ) => Effect.Effect<TaskJournalPruneResult>;
}

export class SchedulerTag extends Context.Tag("bcr/Scheduler")<SchedulerTag, Scheduler>() {}

type TaskFiber = Fiber.RuntimeFiber<ReadonlyArray<ArtifactRef>, SchedulerError>;

const schedulerLayer: Layer.Layer<
  SchedulerTag,
  never,
  ArtifactStoreTag | CacheStoreTag | Executors | ResourceManagerTag | TaskJournalTag
> = Layer.effect(
  SchedulerTag,
  Effect.gen(function* () {
    const artifacts = yield* ArtifactStoreTag;
    const cache = yield* CacheStoreTag;
    const executors = yield* Executors;
    const resources = yield* ResourceManagerTag;
    const journal = yield* TaskJournalTag;

    const admission = yield* Effect.makeSemaphore(1);
    const running = new Map<string, TaskFiber>();
    const pipelines = new Set<Fiber.RuntimeFiber<unknown, unknown>>();
    let closed = false;
    const cacheKeys = new Map<string, string | undefined>();

    const activeCacheKeys = (): ReadonlyArray<string> =>
      [...running.keys()]
        .map((taskId) => cacheKeys.get(taskId))
        .filter((key): key is string => key !== undefined);

    const withActiveCacheProtection = (keys: ReadonlyArray<string>): ReadonlyArray<string> => [
      ...new Set([...keys, ...activeCacheKeys()]),
    ];

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

    const nameOutputs = (
      task: ComputeTask,
      outputs: ReadonlyArray<ArtifactRef>,
    ): ReadonlyArray<ArtifactRef> =>
      outputs.map((ref, index) => {
        const port = task.outputs[index]?.name;
        return port !== undefined && ref.port === undefined ? { ...ref, port } : ref;
      });

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
        } else {
          // 刷新后内存映射为空，退回持久化 task → cache key 关联。
          yield* cache.removeForTask(taskId);
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

    const submitInternal = (
      task: ComputeTask,
      options: SubmitOptions = {},
      /** 存在时，任务事件在产生处同步转发（pipeline 编排用，避免 relay 订阅竞态）。 */
      sink: PubSub.PubSub<TaskEvent> | undefined = undefined,
    ): Effect.Effect<TaskHandle, NoExecutor | TaskFailed> =>
      admission.withPermits(1)(
        Effect.gen(function* () {
          if (closed)
            return yield* new TaskFailed({ taskId: task.id, message: "Runtime is closed" });
          if (running.has(task.id))
            return yield* new TaskFailed({ taskId: task.id, message: "Task is already running" });
          yield* journal.recordSubmitted(task);
          const executor = executors.get(task);
          if (executor === undefined) {
            yield* journal.recordFailed(task.id, `no executor for runtime "${task.runtime}"`);
            return yield* new NoExecutor({ runtime: task.runtime });
          }

          const key = keyFor(task, executor);
          cacheKeys.set(task.id, key);
          yield* artifacts.registerConsumption(task);

          // §7：缓存命中 → 不重算，直接产出缓存的 ArtifactRef。
          if (key !== undefined) {
            const cached = yield* cache.get(key);
            if (cached !== undefined) {
              // SQLite 条目可能比 OPFS 产物活得久；缺任一产物即驱逐并正常重算。
              const exists = yield* Effect.all(cached.map((ref) => artifacts.has(ref)));
              if (exists.every(Boolean)) {
                const named = nameOutputs(task, cached);
                yield* cache.associate(key, task.id);
                yield* artifacts.registerProduction(task.id, named);
                yield* journal.recordCompleted(task.id, named);
                if (sink !== undefined) {
                  yield* PubSub.publish(sink, {
                    type: "completed",
                    taskId: task.id,
                    outputs: [...named],
                  });
                }
                return {
                  state: createTaskState({ status: "completed", progress: 1, outputs: named }),
                  taskId: task.id,
                  events: Stream.succeed<TaskEvent>({
                    type: "completed",
                    taskId: task.id,
                    outputs: [...named],
                  }),
                  await: Effect.succeed(named),
                  cancel: Effect.void,
                  cached: true,
                };
              }
              yield* cache.remove(key);
            }
          }

          const pubsub = yield* PubSub.unbounded<TaskEvent>();
          const state = createTaskState({ status: "queued", progress: 0 });

          const execute: Effect.Effect<ReadonlyArray<ArtifactRef>, SchedulerError> = Effect.gen(
            function* () {
              const events = executor.run(task);
              let outputs: ReadonlyArray<ArtifactRef> | undefined;
              let cacheable = true;
              yield* events.pipe(
                Stream.runForEach((event) =>
                  Effect.gen(function* () {
                    const published: TaskEvent =
                      event.type === "completed"
                        ? {
                            ...event,
                            outputs: [...nameOutputs(task, event.outputs)],
                          }
                        : event;
                    if (published.type === "completed") {
                      outputs = published.outputs;
                      cacheable = published.cacheable !== false;
                    } else if (published.type !== "failed") {
                      if (published.type === "progress") {
                        state.set({ status: "running", progress: published.value });
                      }
                      yield* PubSub.publish(pubsub, published);
                      if (sink !== undefined) yield* PubSub.publish(sink, published);
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
              if (key !== undefined && cacheable) {
                yield* cache.put(key, outputs, task.id);
              }
              // write-ahead 对应的提交点：产物血缘和缓存都稳定后才记 completed。
              yield* journal.recordCompleted(task.id, outputs);
              state.set({ status: "completed", progress: 1, outputs });
              const completed: TaskEvent = {
                type: "completed",
                taskId: task.id,
                outputs: [...outputs],
              };
              yield* PubSub.publish(pubsub, completed);
              if (sink !== undefined) yield* PubSub.publish(sink, completed);
              return outputs;
            },
          );
          // 缓存未命中才占用物理预算；排队/执行被取消时 acquireUseRelease 保证归还。
          let program: Effect.Effect<
            ReadonlyArray<ArtifactRef>,
            SchedulerError
          > = Effect.acquireUseRelease(
            resources.acquire(task.id, task.resources, task.runtime),
            () =>
              journal.recordRunning(task.id).pipe(
                Effect.tap(() => Effect.sync(() => state.set({ status: "running", progress: 0 }))),
                Effect.zipRight(execute),
              ),
            (lease) => lease.release,
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
            Effect.catchAllCause((cause) => {
              if (Cause.isInterruptedOnly(cause)) return Effect.failCause(cause);
              const failure = Cause.failureOption(cause);
              return Effect.fail(
                Option.isSome(failure)
                  ? failure.value
                  : new TaskFailed({ taskId: task.id, message: Cause.pretty(cause) }),
              );
            }),
            Effect.tapError((error) =>
              Effect.sync(() =>
                state.set({
                  status: "failed",
                  progress: state.getSnapshot().progress,
                  error: error.message,
                }),
              ).pipe(
                Effect.zipRight(journal.recordFailed(task.id, error.message)),
                Effect.zipRight(
                  PubSub.publish(pubsub, {
                    type: "failed",
                    taskId: task.id,
                    error: error.message,
                  }),
                ),
              ),
            ),
            Effect.onInterrupt(() =>
              Effect.sync(() =>
                state.set({
                  status: "cancelled",
                  progress: state.getSnapshot().progress,
                  error: "cancelled",
                }),
              ).pipe(
                Effect.zipRight(journal.recordCancelled(task.id)),
                Effect.zipRight(
                  PubSub.publish(pubsub, {
                    type: "failed",
                    taskId: task.id,
                    error: "cancelled",
                  }),
                ),
              ),
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
            state,
            taskId: task.id,
            events: Stream.fromPubSub(pubsub),
            await: Fiber.join(fiber),
            cancel: cancelCascade(task.id, new Set()),
            cached: false,
          };
        }),
      );

    const submit = (
      task: ComputeTask,
      options: SubmitOptions = {},
    ): Effect.Effect<TaskHandle, NoExecutor | TaskFailed> => submitInternal(task, options);

    const recoverPending = (options: RecoveryOptions = {}): Effect.Effect<RecoveryReport> =>
      Effect.gen(function* () {
        const entries = yield* journal.entries;
        const resumed: RecoveredTask[] = [];
        const skipped: RecoverySkip[] = [];

        for (const entry of entries) {
          const eligible =
            entry.status === "queued" ||
            entry.status === "running" ||
            (options.includeFailed === true &&
              (entry.status === "failed" || entry.status === "blocked"));
          if (!eligible) continue;

          if (running.has(entry.task.id)) {
            skipped.push({
              taskId: entry.task.id,
              reason: "task is already active",
            });
            continue;
          }

          const inputExists = yield* Effect.all(
            entry.task.inputs.map((input) => artifacts.has(input)),
          );
          const missing = entry.task.inputs.filter((_, index) => inputExists[index] !== true);
          if (missing.length > 0) {
            const reason = `missing input artifacts: ${missing.map((ref) => ref.id).join(", ")}`;
            yield* journal.recordBlocked(entry.task.id, reason);
            skipped.push({ taskId: entry.task.id, reason });
            continue;
          }

          if (executors.get(entry.task) === undefined) {
            const reason = `no executor for runtime "${entry.task.runtime}"`;
            yield* journal.recordFailed(entry.task.id, reason);
            skipped.push({ taskId: entry.task.id, reason });
            continue;
          }

          const submitted = yield* Effect.either(submitInternal(entry.task, options.submit));
          if (submitted._tag === "Right") {
            resumed.push({ entry, handle: submitted.right });
          } else {
            const reason =
              submitted.left._tag === "TaskFailed"
                ? submitted.left.message
                : `no executor for runtime "${submitted.left.runtime}"`;
            yield* journal.recordFailed(entry.task.id, reason);
            skipped.push({ taskId: entry.task.id, reason });
          }
        }

        return { resumed, skipped };
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

    const planCachePrune = (options: CachePruneOptions = {}): Effect.Effect<CachePrunePlan> =>
      cache.planPrune({
        ...options,
        protectedKeys: withActiveCacheProtection(options.protectedKeys ?? []),
      });

    const reclaimCache = (
      plan: CachePrunePlan,
      options?: Pick<CachePruneOptions, "protectedKeys">,
    ): Effect.Effect<CachePruneResult> =>
      cache.reclaim(plan, {
        protectedKeys: withActiveCacheProtection(options?.protectedKeys ?? plan.protectedKeys),
      });

    const planJournalPrune = (
      options?: TaskJournalPruneOptions,
    ): Effect.Effect<TaskJournalPrunePlan> => journal.planPrune(options);

    const reclaimJournal = (
      plan: TaskJournalPrunePlan,
      options?: Pick<TaskJournalPruneOptions, "protectedTaskIds">,
    ): Effect.Effect<TaskJournalPruneResult> => journal.reclaim(plan, options);

    type PipelineNodeState = {
      readonly node: PipelineNode;
      readonly deferred: Deferred.Deferred<ReadonlyArray<ArtifactRef>, SchedulerError>;
    };

    const dependenciesOf = (node: PipelineNode): ReadonlyArray<string> => [
      ...new Set([...(node.after ?? []), ...(node.bindings?.map((binding) => binding.from) ?? [])]),
    ];

    const submitPipeline = (
      pipelineId: string,
      nodes: ReadonlyArray<PipelineNode>,
      options: SubmitOptions = {},
    ): Effect.Effect<PipelineHandle, InvalidPipeline | NoExecutor> =>
      Effect.gen(function* () {
        if (closed) return yield* new InvalidPipeline({ pipelineId, message: "Runtime is closed" });
        // 图校验：重复 id / 未知依赖
        const byId = new Map<string, PipelineNodeState>();
        for (const node of nodes) {
          if (byId.has(node.id)) {
            return yield* new InvalidPipeline({
              pipelineId,
              message: `duplicate node id "${node.id}"`,
            });
          }
          byId.set(node.id, {
            node,
            deferred: yield* Deferred.make<ReadonlyArray<ArtifactRef>, SchedulerError>(),
          });
        }
        for (const node of nodes) {
          for (const dep of dependenciesOf(node)) {
            if (!byId.has(dep)) {
              return yield* new InvalidPipeline({
                pipelineId,
                message: `node "${node.id}" depends on unknown node "${dep}"`,
              });
            }
          }
          const occupiedInputs = new Set(
            (node.inputs ?? []).flatMap((ref) => (ref.port === undefined ? [] : [ref.port])),
          );
          for (const binding of node.bindings ?? []) {
            const source = byId.get(binding.from)?.node;
            if (source === undefined) continue;
            if (!source.outputs.some((output) => output.name === binding.output)) {
              return yield* new InvalidPipeline({
                pipelineId,
                message: `node "${node.id}" binds unknown output "${binding.from}.${binding.output}"`,
              });
            }
            if (occupiedInputs.has(binding.input)) {
              return yield* new InvalidPipeline({
                pipelineId,
                message: `node "${node.id}" has multiple values for input "${binding.input}"`,
              });
            }
            occupiedInputs.add(binding.input);
          }
        }

        const stateOf = (id: string): PipelineNodeState => {
          const state = byId.get(id);
          if (state === undefined) {
            throw new Error(`unreachable: node "${id}" passed graph validation`);
          }
          return state;
        };

        // 环检测（§3 DAG 必须无环）
        const visiting = new Set<string>();
        const settled = new Set<string>();
        const detectCycle = (
          id: string,
          trail: ReadonlyArray<string>,
        ): Effect.Effect<void, InvalidPipeline> =>
          Effect.gen(function* () {
            if (settled.has(id)) return;
            if (visiting.has(id)) {
              const start = trail.indexOf(id);
              return yield* new InvalidPipeline({
                pipelineId,
                message: `dependency cycle: ${[...trail.slice(start), id].join(" → ")}`,
              });
            }
            visiting.add(id);
            for (const dep of dependenciesOf(stateOf(id).node)) {
              yield* detectCycle(dep, [...trail, id]);
            }
            visiting.delete(id);
            settled.add(id);
          });
        for (const node of nodes) {
          yield* detectCycle(node.id, []);
        }

        const pubsub = yield* PubSub.unbounded<TaskEvent>();

        const runNode = (
          state: PipelineNodeState,
        ): Effect.Effect<ReadonlyArray<ArtifactRef>, SchedulerError> =>
          Effect.gen(function* () {
            const { node, deferred } = state;
            const dependencyIds = dependenciesOf(node);
            const dependencyResults = yield* Effect.all(
              dependencyIds.map((id) => Deferred.await(stateOf(id).deferred)),
            );
            const outputsByNode = new Map(
              dependencyIds.map((id, index) => [id, dependencyResults[index] ?? []]),
            );
            const dependencyInputs =
              node.bindings !== undefined
                ? yield* Effect.forEach(node.bindings, (binding) =>
                    Effect.gen(function* () {
                      const source = stateOf(binding.from).node;
                      const outputIndex = source.outputs.findIndex(
                        (output) => output.name === binding.output,
                      );
                      const ref = outputsByNode.get(binding.from)?.[outputIndex];
                      if (ref === undefined) {
                        return yield* new TaskFailed({
                          taskId: `${pipelineId}/${node.id}`,
                          message: `bound output "${binding.from}.${binding.output}" was not produced`,
                        });
                      }
                      return { ...ref, port: binding.input };
                    }),
                  )
                : dependencyResults.flat();
            const task: ComputeTask = {
              id: `${pipelineId}/${node.id}`,
              runtime: node.runtime,
              operation: node.operation,
              inputs: [...(node.inputs ?? []), ...dependencyInputs],
              outputs: [...node.outputs],
              ...(node.resources !== undefined ? { resources: node.resources } : {}),
              ...(node.cache !== undefined ? { cache: node.cache } : {}),
              ...(node.config !== undefined ? { config: node.config } : {}),
            };

            // sink 转发：任务事件在产生处同步汇入流水线 PubSub，无订阅竞态
            const handle = yield* submitInternal(task, options, pubsub);

            const outputs = yield* handle.await.pipe(
              // 节点失败/被中断 → 取消其任务 fiber（Task 生命周期 ≠ Pipeline 生命周期）
              Effect.onExit((exit) => (Exit.isSuccess(exit) ? Effect.void : handle.cancel)),
            );
            yield* Deferred.succeed(deferred, outputs);
            return outputs;
          });

        // fail-fast：任一节点失败 → 整条流水线失败，其余节点被中断
        const program = Effect.all([...byId.values()].map(runNode), {
          concurrency: "unbounded",
          discard: true,
        }).pipe(
          Effect.zipRight(
            Effect.gen(function* () {
              const results = new Map<string, ReadonlyArray<ArtifactRef>>();
              for (const [id, state] of byId) {
                results.set(id, yield* Deferred.await(state.deferred));
              }
              return results;
            }),
          ),
          Effect.tapError((error) =>
            PubSub.publish(pubsub, {
              type: "failed",
              taskId: pipelineId,
              error:
                error._tag === "TaskFailed"
                  ? error.message
                  : error._tag === "ArtifactNotFound"
                    ? `artifact not found: ${error.artifactId}`
                    : `no executor for runtime "${error.runtime}"`,
            }),
          ),
          Effect.ensuring(PubSub.shutdown(pubsub)),
        );

        const fiber = yield* Effect.forkDaemon(program);
        pipelines.add(fiber);
        yield* Effect.forkDaemon(
          Fiber.await(fiber).pipe(Effect.tap(() => Effect.sync(() => pipelines.delete(fiber)))),
        );
        return {
          pipelineId,
          events: Stream.fromPubSub(pubsub),
          await: Fiber.join(fiber),
          cancel: Fiber.interrupt(fiber),
        };
      });

    return {
      shutdown: Effect.gen(function* () {
        closed = true;
        yield* admission.withPermits(1)(Effect.void);
        yield* Effect.forEach([...pipelines], Fiber.interrupt, { concurrency: "unbounded" });
        yield* Effect.forEach([...running.values()], Fiber.interrupt, { concurrency: "unbounded" });
      }),
      resourceSnapshot: resources.snapshot,
      journalSnapshot: journal.entries,
      submit,
      submitPipeline,
      cancel: (taskId) => cancelCascade(taskId, new Set()),
      recoverPending,
      invalidateArtifact,
      planCachePrune,
      reclaimCache,
      planJournalPrune,
      reclaimJournal,
    };
  }),
);

/** 默认能力预算下的 Scheduler，保持原有零配置装配方式。 */
export const schedulerLive: Layer.Layer<
  SchedulerTag,
  never,
  ArtifactStoreTag | CacheStoreTag | Executors
> = Layer.provide(
  schedulerLayer,
  Layer.mergeAll(resourceManagerLive(defaultResourceCapacity()), memoryTaskJournal()),
);

/** 宿主/测试可注入明确预算，复用同一调度实现。 */
export function schedulerLiveWithCapacity(
  capacity: ResourceCapacity,
): Layer.Layer<SchedulerTag, never, ArtifactStoreTag | CacheStoreTag | Executors> {
  return Layer.provide(
    schedulerLayer,
    Layer.mergeAll(resourceManagerLive(capacity), memoryTaskJournal()),
  );
}

/** 宿主注入持久化 TaskJournal；资源预算仍可按设备能力覆盖。 */
export function schedulerLiveWithJournal(
  journal: Layer.Layer<TaskJournalTag>,
  capacity: ResourceCapacity = defaultResourceCapacity(),
): Layer.Layer<SchedulerTag, never, ArtifactStoreTag | CacheStoreTag | Executors> {
  return Layer.provide(schedulerLayer, Layer.mergeAll(resourceManagerLive(capacity), journal));
}

/** Sessions in one host inject the same resource manager. */
export const schedulerWithServices = schedulerLayer;
