import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { ResearchCaptureProvider, useRuntime, type ResearchCaptureService } from "@bcr/react";
import { workspaceResearch, saveResearchCapture } from "./researchCapture";

export function ResearchCaptureBridge(props: { children: ReactNode }) {
  const { metadata } = useRuntime();
  const store = useMemo(() => workspaceResearch(metadata), [metadata]);
  const library = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [state, setState] = useState({ ready: false, error: null as string | null });
  useEffect(() => {
    let active = true;
    setState({ ready: false, error: null });
    void store.ready.then(
      () => {
        if (active) setState({ ready: true, error: null });
      },
      (error: unknown) => {
        if (active) setState({ ready: false, error: String(error) });
      },
    );
    return () => {
      active = false;
    };
  }, [store]);
  const service = useMemo<ResearchCaptureService>(
    () => ({
      ...state,
      collections: library.collections,
      save: (collection, capture) => saveResearchCapture(store, collection, capture),
    }),
    [state, library, store],
  );
  return <ResearchCaptureProvider service={service}>{props.children}</ResearchCaptureProvider>;
}
