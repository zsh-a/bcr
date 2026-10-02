import { type ReaderState } from "./model";
import { useSyncExternalStore } from "react";
import { reader } from "./store";

export function useReader<T>(selector: (state: ReaderState) => T): T {
  return useSyncExternalStore(
    reader.subscribe,
    () => selector(reader.getSnapshot()),
    () => selector(reader.getSnapshot()),
  );
}
