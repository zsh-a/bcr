import { useEffect, useMemo, useRef } from "react";
import { useAgentHost, useRuntimeActivity } from "@bcr/react";
import type { NoteDraft } from "./draft";
import { createNoteAgent, type NoteSelection } from "./editorAgent";

export function useNoteAgent(controller: NoteDraft, selection: NoteSelection) {
  const host = useAgentHost(),
    active = useRuntimeActivity();
  const latest = useRef({ active, selection });
  latest.current = { active, selection };
  const adapter = useMemo(() => createNoteAgent(controller, () => latest.current), [controller]);
  useEffect(() => {
    const unregisterSurface = host.registerSurface(adapter.surface);
    const unregisterCapability = host.registerAgentCapability(adapter.capability);
    return () => {
      unregisterCapability();
      unregisterSurface();
    };
  }, [host, adapter]);
  useEffect(() => {
    if (active) host.activateSurface(adapter.surface.kind);
    else if (host.activeSurface() === adapter.surface) host.activateSurface(null);
    host.refreshSurface(adapter.surface);
  }, [host, adapter, active, selection, controller.getSnapshot().note, controller.editable]);
}
