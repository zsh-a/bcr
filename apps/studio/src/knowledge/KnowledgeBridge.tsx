import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useRuntime } from "@bcr/react";
import { publishKnowledge, workspaceKnowledge } from "./store";

export function KnowledgeBridge() {
  const { metadata, search } = useRuntime();
  const store = useMemo(() => workspaceKnowledge(metadata), [metadata]);
  const content = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => {
    let active = true;
    if (search)
      void Promise.all([store.ready, search.ready])
        .then(() => {
          if (active) publishKnowledge(search, content);
        })
        .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [store, search, content]);
  return null;
}
