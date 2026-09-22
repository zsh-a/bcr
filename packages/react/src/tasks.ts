import { useCallback, useSyncExternalStore } from "react";
import { Effect } from "effect";
import type { ComputeTask, SubmitOptions, TaskHandle, TaskSnapshot } from "@bcr/core";
import { useRuntime } from "./runtime";

export function useSubmitTask(): (
  task: ComputeTask,
  options?: SubmitOptions,
) => Promise<TaskHandle> {
  const { scheduler } = useRuntime();
  return useCallback(
    (task, options) => Effect.runPromise(scheduler.submit(task, options)),
    [scheduler],
  );
}

export type TaskState = TaskSnapshot | { readonly status: "idle"; readonly progress: 0 };
const idle: TaskState = { status: "idle", progress: 0 };
const idleSnapshot = () => idle;
const idleSubscribe = () => () => undefined;

export function useTask(handle: TaskHandle | null): TaskState {
  return useSyncExternalStore<TaskState>(
    handle?.state.subscribe ?? idleSubscribe,
    handle?.state.getSnapshot ?? idleSnapshot,
    handle?.state.getSnapshot ?? idleSnapshot,
  );
}
