import { useEffect, useState, useSyncExternalStore } from "react";
import type { KnowledgeNote } from "./model";
import type { KnowledgeStore } from "./store";
import { NoteDraft, type DraftStorage } from "./draft";

// Access to the browser storage property itself may throw in restricted contexts.
const browserDraftStorage: DraftStorage = {
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
  removeItem: (key) => localStorage.removeItem(key),
};

/** Browser lifecycle only; the controller owns all draft/persistence decisions. */
export function useNoteDraft(note: KnowledgeNote, store: KnowledgeStore, locked: boolean) {
  const [controller] = useState(() => new NoteDraft(note, store, browserDraftStorage));
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  controller.setLocked(locked);
  useEffect(() => controller.receive(note), [controller, note]);
  useEffect(() => {
    if (!snapshot.dirty || locked) return;
    const timer = setTimeout(() => {
      void controller.flush().catch(() => undefined);
    }, 500);
    return () => clearTimeout(timer);
  }, [controller, snapshot.note, snapshot.dirty, locked]);
  useEffect(() => {
    const unregister = store.registerDraft(
      note.id,
      () => controller.getSnapshot().dirty || !controller.editable,
    );
    const unload = (event: BeforeUnloadEvent) => {
      if (controller.getSnapshot().dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => {
      window.removeEventListener("beforeunload", unload);
      void controller
        .flush()
        .catch(() => undefined)
        .finally(unregister);
    };
  }, [controller, store, note.id]);
  return { controller, ...snapshot };
}
