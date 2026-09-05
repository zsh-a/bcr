import { Context, Stream } from "effect";
import type { TaskFailed } from "./errors";
import type { ComputeTask, RuntimeKind, TaskEvent } from "./schema";

/** Runtime describes a compute backend; operations select the actual executor. */
export interface RuntimeExecutor {
  readonly operations: ReadonlyArray<string>;
  readonly runtime: RuntimeKind;
  readonly version: string;
  readonly run: (task: ComputeTask) => Stream.Stream<TaskEvent, TaskFailed>;
}

export interface ExecutorRegistry {
  readonly get: (task: Pick<ComputeTask, "runtime" | "operation">) => RuntimeExecutor | undefined;
}

export class Executors extends Context.Tag("bcr/Executors")<Executors, ExecutorRegistry>() {}

export function executorRegistry(executors: ReadonlyArray<RuntimeExecutor>): ExecutorRegistry {
  const routes = new Map<string, RuntimeExecutor>();
  const key = (runtime: RuntimeKind, operation: string) => JSON.stringify([runtime, operation]);
  for (const executor of executors) {
    if (executor.operations.length === 0) throw new Error("Executor must declare its operations");
    for (const operation of executor.operations) {
      const route = key(executor.runtime, operation);
      if (routes.has(route))
        throw new Error(`Duplicate executor for ${operation} (${executor.runtime})`);
      routes.set(route, executor);
    }
  }
  return { get: (task) => routes.get(key(task.runtime, task.operation)) };
}
