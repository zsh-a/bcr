import { availableCopyPath } from "../notes/paths";
import { validateConflictMerge } from "../sync/conflictMerge";
import { withKnowledgeHistory } from "./stateTransitions";
import {
  copyName,
  same,
  NOTE_TITLE_MAX,
  COLLECTION_NAME_MAX,
  type KnowledgeState,
  type KnowledgeNote,
  type KnowledgeConflict,
} from "./model";

export function resolveConflictState(
  state: KnowledgeState,
  conflict: KnowledgeConflict,
  choice: "local" | "remote" | "keep-both" | "merge",
  merged?: KnowledgeNote | null,
): KnowledgeState {
  const current = state.conflicts.find((c) => c.kind === conflict.kind && c.key === conflict.key);
  if (!current || !same(current, conflict)) throw new Error("冲突已变化，请重新打开");
  const notes = { ...state.notes },
    collections = { ...state.collections };
  const selected =
    choice === "merge"
      ? validateConflictMerge(current, merged)
      : choice === "remote"
        ? current.remote
        : current.local;
  const map = current.kind === "note" ? notes : collections;
  if (selected) Object.assign(map, { [current.key]: selected });
  else delete map[current.key];
  if (choice === "keep-both" && current.remote) {
    const id = crypto.randomUUID();
    if (current.kind === "note")
      notes[id] = {
        ...(current.remote as KnowledgeNote),
        id,
        title: copyName((current.remote as KnowledgeNote).title, NOTE_TITLE_MAX, "（远端副本）"),
        ...((current.remote as KnowledgeNote).path === undefined
          ? {}
          : {
              path: availableCopyPath(
                (current.remote as KnowledgeNote).path!,
                notes,
                state.folders,
              ),
            }),
        updatedAt: Date.now(),
      };
    else
      collections[id] = {
        id,
        name: copyName(
          "name" in current.remote ? current.remote.name : "集合",
          COLLECTION_NAME_MAX,
          "（远端副本）",
        ),
      };
  }
  const next = withKnowledgeHistory(
    state,
    { notes, collections, folders: state.folders },
    "解决冲突前版本",
  );
  if (choice === "merge" && current.local && same(state.notes[current.key], selected))
    next.history = [
      {
        id: crypto.randomUUID(),
        note: current.local as KnowledgeNote,
        at: Date.now(),
        reason: "合并前本机版本",
      },
      ...next.history,
    ].slice(0, 100);
  // Also retain the unselected remote note in history, including delete/edit conflicts.
  if (
    current.kind === "note" &&
    current.remote &&
    (choice === "merge" || !same(current.remote, selected))
  )
    next.history = [
      {
        id: crypto.randomUUID(),
        note: current.remote as KnowledgeNote,
        at: Date.now(),
        reason: "冲突远端版本",
      },
      ...next.history,
    ].slice(0, 100);
  return { ...next, conflicts: state.conflicts.filter((c) => c !== current) };
}
