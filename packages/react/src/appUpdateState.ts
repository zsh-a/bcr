import { useSyncExternalStore } from "react";

export type AppUpdateState = {
  phase: "unavailable" | "idle" | "checking" | "current" | "ready" | "reload" | "error";
  message?: string;
};

let state: AppUpdateState = { phase: "unavailable" };
const listeners = new Set<() => void>();
let check: (() => void) | undefined;
let apply: (() => void) | undefined;

export function setAppUpdateState(next: AppUpdateState): void {
  state = next;
  for (const listener of listeners) listener();
}

export function configureAppUpdates(actions: { check: () => void; apply: () => void }): void {
  check = actions.check;
  apply = actions.apply;
  setAppUpdateState({ phase: "idle" });
}

export function checkForAppUpdate(): void {
  check?.();
}

export function applyAppUpdate(): void {
  if (!apply) throw new Error("当前环境无法更新，请保存后重新加载页面。");
  apply();
}

export function useAppUpdateState(): AppUpdateState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => state,
  );
}
