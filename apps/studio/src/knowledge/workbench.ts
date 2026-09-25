import { validId } from "./model";

export interface WorkbenchState {
  tabs: string[];
  pinned: string[];
  recent: string[];
  favorites: string[];
}
export const MAX_TABS = 20;
export const emptyWorkbench = (): WorkbenchState => ({
  tabs: [],
  pinned: [],
  recent: [],
  favorites: [],
});
export const WORKBENCH_KEY = "bcr/knowledge-workbench/v1";
export function decodeWorkbench(raw: string | null): WorkbenchState {
  try {
    const value = JSON.parse(raw ?? "null");
    if (value?.version !== 1) return emptyWorkbench();
    const ids = (items: unknown, max: number): string[] =>
      Array.isArray(items) ? [...new Set(items.filter(validId))].slice(0, max) : [];
    const tabs = ids(value.tabs, MAX_TABS);
    return {
      tabs,
      pinned: ids(value.pinned, MAX_TABS).filter((id) => tabs.includes(id)),
      recent: ids(value.recent, 50),
      favorites: ids(value.favorites, 500),
    };
  } catch {
    return emptyWorkbench();
  }
}
/** 记录“最近”浏览，不隐式开标签；标签只由显式打开动作创建。 */
export function visitNote(state: WorkbenchState, id: string): WorkbenchState {
  return { ...state, recent: [id, ...state.recent.filter((item) => item !== id)].slice(0, 50) };
}
/** 显式打开：进入标签栏并记录最近；超限先淘汰最早的未固定标签。 */
export function openNote(state: WorkbenchState, id: string): WorkbenchState {
  const visited = visitNote(state, id);
  if (visited.tabs.includes(id)) return visited;
  const tabs = [...visited.tabs, id];
  while (tabs.length > MAX_TABS) {
    const evict = tabs.find((item) => !visited.pinned.includes(item));
    if (!evict) break;
    tabs.splice(tabs.indexOf(evict), 1);
  }
  return { ...visited, tabs };
}
export function closeNote(state: WorkbenchState, id: string): WorkbenchState {
  return {
    ...state,
    tabs: state.tabs.filter((item) => item !== id),
    pinned: state.pinned.filter((item) => item !== id),
  };
}
/** 关闭其他标签：当前标签与固定标签保留。 */
export function closeOtherNotes(state: WorkbenchState, id: string): WorkbenchState {
  const keep = new Set([id, ...state.pinned]);
  return { ...state, tabs: state.tabs.filter((item) => keep.has(item)) };
}
export function togglePinned(state: WorkbenchState, id: string): WorkbenchState {
  if (!state.tabs.includes(id)) return state;
  return {
    ...state,
    pinned: state.pinned.includes(id)
      ? state.pinned.filter((item) => item !== id)
      : [...state.pinned, id].slice(-MAX_TABS),
  };
}
export function toggleFavorite(state: WorkbenchState, id: string): WorkbenchState {
  return {
    ...state,
    favorites: state.favorites.includes(id)
      ? state.favorites.filter((item) => item !== id)
      : [...state.favorites, id].slice(-500),
  };
}
export function localDay(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function fillTemplate(body: string, title: string, date = new Date()) {
  return body.replace(/\{\{(date|title)\}\}/gu, (_, name: string) =>
    name === "date" ? localDay(date) : title,
  );
}
