import type { ArtifactRef } from "@bcr/core";
import type { TrendResult, TrendRun } from "@bcr/quant-core/trend";

export type TrendResultSelection = Pick<TrendRun, "id" | "resultRef">;
interface ResultIdentity {
  runId: string;
  resultRef: ArtifactRef;
}
export type TrendResultState =
  | { status: "idle" }
  | (ResultIdentity & { status: "loading" })
  | (ResultIdentity & { status: "ready"; result: TrendResult })
  | (ResultIdentity & { status: "error"; error: string });

function matches(state: ResultIdentity, selected: TrendResultSelection): boolean {
  const a = state.resultRef,
    b = selected.resultRef;
  return (
    state.runId === selected.id &&
    a.id === b.id &&
    a.hash === b.hash &&
    a.storage === b.storage &&
    a.type === b.type &&
    a.format === b.format
  );
}

/** Selection changes take effect during render, before the next loading effect runs. */
export function selectedTrendResult(
  state: TrendResultState,
  selected: TrendResultSelection | null,
): TrendResultState {
  if (!selected) return { status: "idle" };
  return state.status !== "idle" && matches(state, selected)
    ? state
    : { status: "loading", runId: selected.id, resultRef: selected.resultRef };
}

/** One active read; obsolete successes and failures never publish over a newer selection. */
export function createTrendResultLoader(read: (ref: ArtifactRef) => Promise<TrendResult>) {
  let state: TrendResultState = { status: "idle" };
  let revision = 0;
  const listeners = new Set<() => void>();
  const publish = (next: TrendResultState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    cancel() {
      revision += 1;
    },
    async load(selected: TrendResultSelection | null): Promise<void> {
      const request = ++revision;
      if (!selected) {
        publish({ status: "idle" });
        return;
      }
      const identity = { runId: selected.id, resultRef: selected.resultRef };
      publish({ ...identity, status: "loading" });
      try {
        const result = await read(identity.resultRef);
        if (request === revision) publish({ ...identity, status: "ready", result });
      } catch (error) {
        if (request === revision)
          publish({
            ...identity,
            status: "error",
            error: `读取结果失败：${error instanceof Error ? error.message : String(error)}`,
          });
      }
    },
  };
}
