import type { ArtifactRef } from "./schema";

/** Durable completion and transient progress share one authoritative projection. */
export type TaskSnapshot =
  | { readonly status: "queued" | "running"; readonly progress: number }
  | {
      readonly status: "completed";
      readonly progress: 1;
      readonly outputs: ReadonlyArray<ArtifactRef>;
    }
  | { readonly status: "failed" | "cancelled"; readonly progress: number; readonly error: string };

export interface TaskStateStore {
  readonly getSnapshot: () => TaskSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
}

export function createTaskState(initial: TaskSnapshot) {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set: (next: TaskSnapshot) => {
      snapshot = next;
      for (const listener of listeners) listener();
    },
  };
}
