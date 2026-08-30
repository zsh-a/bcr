import { Context, Stream } from "effect";
import type { TaskFailed } from "./errors";
import type { ComputeTask, RuntimeKind, TaskEvent } from "./schema";

/**
 * Runtime 执行器：按 task.runtime 分发（架构文档 §0 的按负载分发）。
 *
 * 执行器把一次任务执行表达为 TaskEvent 流（§6.2），
 * 取消由 Effect interruption 承载，执行器需响应中断。
 */
export interface RuntimeExecutor {
  readonly runtime: RuntimeKind;
  /** 参与 cacheKey（§7）：kernel / runtime 升级后旧缓存自动失效。 */
  readonly version: string;
  readonly run: (task: ComputeTask) => Stream.Stream<TaskEvent, TaskFailed>;
}

export interface ExecutorRegistry {
  readonly get: (runtime: RuntimeKind) => RuntimeExecutor | undefined;
}

export class Executors extends Context.Tag("bcr/Executors")<Executors, ExecutorRegistry>() {}

export function executorRegistry(executors: ReadonlyArray<RuntimeExecutor>): ExecutorRegistry {
  const byRuntime = new Map(executors.map((e) => [e.runtime, e]));
  return { get: (runtime) => byRuntime.get(runtime) };
}
