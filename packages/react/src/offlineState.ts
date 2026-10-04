import { useSyncExternalStore } from "react";

export type OfflineState = {
  phase: "preparing" | "ready" | "error" | "unavailable";
  message?: string;
};
let state: OfflineState = { phase: "unavailable" };
const listeners = new Set<() => void>();
export function setAppOfflineState(next: OfflineState): void {
  state = next;
  for (const listener of listeners) listener();
}
export function useAppOfflineState(): OfflineState {
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
let persistence: Promise<boolean> | undefined;
/** Request once per session after a meaningful write. Failure never blocks saving. */
export function protectLocalData(retry = false): Promise<boolean> {
  if (retry) persistence = undefined;
  persistence ??= (async () => {
    if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
    return (await navigator.storage.persisted()) || navigator.storage.persist();
  })().catch(() => false);
  return persistence;
}
