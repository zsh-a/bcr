import type { MangaState } from "./model";
import { useSyncExternalStore } from "react";
import { manga } from "./store";

export function useMangaStudio<T>(selector: (state: MangaState) => T): T {
  return useSyncExternalStore(manga.subscribe, () => selector(manga.getSnapshot()));
}
