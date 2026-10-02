import { useSyncExternalStore } from "react";
import { type DocumentState, documents } from "./store";

export function useDocumentStudio<T>(selector: (state: DocumentState) => T): T {
  return useSyncExternalStore(
    documents.subscribe,
    () => selector(documents.getSnapshot()),
    () => selector(documents.getSnapshot()),
  );
}
