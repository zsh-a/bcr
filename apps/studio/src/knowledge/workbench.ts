import { validId } from "./model";

export interface WorkbenchState {
  tabs: string[];
  recent: string[];
  favorites: string[];
}
export const emptyWorkbench = (): WorkbenchState => ({ tabs: [], recent: [], favorites: [] });
export const WORKBENCH_KEY = "bcr/knowledge-workbench/v1";
export function decodeWorkbench(raw: string | null): WorkbenchState {
  try {
    const value = JSON.parse(raw ?? "null");
    if (value?.version !== 1) return emptyWorkbench();
    const ids = (items: unknown, max: number): string[] =>
      Array.isArray(items) ? [...new Set(items.filter(validId))].slice(0, max) : [];
    return {
      tabs: ids(value.tabs, 20),
      recent: ids(value.recent, 50),
      favorites: ids(value.favorites, 500),
    };
  } catch {
    return emptyWorkbench();
  }
}
export function visitNote(state: WorkbenchState, id: string): WorkbenchState {
  const recent = [id, ...state.recent.filter((item) => item !== id)].slice(0, 50);
  const tabs = state.tabs.includes(id) ? state.tabs : [...state.tabs, id].slice(-20);
  return { ...state, tabs, recent };
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
