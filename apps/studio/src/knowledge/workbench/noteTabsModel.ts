import type { KnowledgeNote } from "../session/model";

/** A single-click preview stays visible without changing the user's saved tabs. */
export function visibleNoteTabs(
  ids: readonly string[],
  notes: Record<string, KnowledgeNote>,
  activeId?: string,
) {
  const tabs = ids.filter((id) => Object.hasOwn(notes, id));
  return activeId && Object.hasOwn(notes, activeId) && !tabs.includes(activeId)
    ? [...tabs, activeId]
    : tabs;
}

export function adjacentNoteTab(ids: readonly string[], id: string) {
  const index = ids.indexOf(id);
  return index < 0 ? undefined : (ids[index + 1] ?? ids[index - 1]);
}
