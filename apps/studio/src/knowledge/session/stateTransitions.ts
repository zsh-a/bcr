import { sameRecord } from "./comparison";
import { mergeContent } from "../sync/merge";
import { contentOf, type KnowledgeState, type KnowledgeContent } from "./model";

export function withKnowledgeHistory(
  state: KnowledgeState,
  next: KnowledgeContent,
  reason: string,
): KnowledgeState {
  const revisions = Object.values(state.notes)
    .filter((note) => !sameRecord(note, next.notes[note.id]))
    .map((note) => ({ id: crypto.randomUUID(), note, at: Date.now(), reason }));
  return { ...state, ...next, history: [...revisions, ...state.history].slice(0, 100) };
}

export function integrateSyncState(
  state: KnowledgeState,
  remote: KnowledgeContent,
  head: string,
  base: KnowledgeContent,
): KnowledgeState {
  const merged = mergeContent(base, contentOf(state), remote);
  return {
    ...withKnowledgeHistory(state, merged.content, "同步前版本"),
    conflicts: merged.conflicts,
    sync: {
      ...state.sync,
      base: remote,
      head,
      pending: null,
      lastSyncedAt: Date.now(),
    },
  };
}
