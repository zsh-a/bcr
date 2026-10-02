import { useSyncExternalStore } from "react";
import { type StudioState, studio } from "./store";

export function useStudio<T>(selector: (state: StudioState) => T): T {
  return useSyncExternalStore(studio.subscribe, () => selector(studio.getSnapshot()));
}
