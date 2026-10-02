import { useSyncExternalStore } from "react";
import { type AppState, studio } from "./store";

export function useStudio<T>(selector: (state: AppState) => T): T {
  return useSyncExternalStore(studio.subscribe, () => selector(studio.getSnapshot()));
}
