import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  ResearchCaptureProvider,
  useRuntime,
  useUpdateParticipant,
  type ResearchCaptureService,
} from "@bcr/react";
import { saveResearchCapture } from "./capture";
import { workspaceServices } from "../workspace";

export function ResearchCaptureBridge(props: { children: ReactNode; enabled?: boolean }) {
  return props.enabled === false ? (
    props.children
  ) : (
    <CaptureProvider>{props.children}</CaptureProvider>
  );
}
function CaptureProvider(props: { children: ReactNode }) {
  const runtime = useRuntime();
  const store = useMemo(() => workspaceServices(runtime).research, [runtime]);
  const library = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [state, setState] = useState({ ready: false, error: null as string | null });
  useUpdateParticipant({
    blocked: () =>
      !state.ready
        ? "资料库尚未就绪，请稍后更新。"
        : workspaceServices(runtime).knowledge.syncing
          ? "知识库正在同步，请完成后再更新。"
          : null,
    save: async () => {
      await workspaceServices(runtime).knowledge.flush();
      await store.flush();
    },
  });
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
