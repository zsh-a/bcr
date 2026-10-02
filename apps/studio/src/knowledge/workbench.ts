import { validId } from "./model";

/** 侧栏形态：展开（完整面板）/ 图标栏（56px）/ 全隐藏。 */
export type SidebarForm = "expanded" | "rail" | "hidden";
/** 笔记信息面板：宽屏在右侧展开，窄屏通过模态抽屉展开。 */
export type ContextForm = "expanded" | "hidden";
export interface WorkbenchState {
  tabs: string[];
  pinned: string[];
  recent: string[];
  favorites: string[];
  sidebar: SidebarForm;
  /** 拖拽调节后的侧栏宽度（px）；null 表示跟随 --w-sidebar 的流体默认。 */
  sidebarWidth: number | null;
  context: ContextForm;
  /** 拖拽调节后的上下文栏宽度（px）；null 表示跟随 --w-context 的流体默认。 */
  contextWidth: number | null;
}
export const MAX_TABS = 20;
/** 侧栏宽度上下限：下限容得下目录树行，上限不把正文挤出舒适行宽。 */
export const SIDEBAR_MIN_WIDTH = 240;
export const SIDEBAR_MAX_WIDTH = 640;
/** 上下文栏宽度上下限：大纲行要读得清，也不与正文争宽。 */
export const CONTEXT_MIN_WIDTH = 200;
export const CONTEXT_MAX_WIDTH = 480;
export const emptyWorkbench = (): WorkbenchState => ({
  tabs: [],
  pinned: [],
  recent: [],
  favorites: [],
  sidebar: "expanded",
  sidebarWidth: null,
  context: "hidden",
  contextWidth: null,
});
export const WORKBENCH_KEY = "bcr/knowledge-workbench/v1";
export function decodeWorkbench(raw: string | null): WorkbenchState {
  try {
    const value = JSON.parse(raw ?? "null");
    if (value?.version !== 1) return emptyWorkbench();
    const ids = (items: unknown, max: number): string[] =>
      Array.isArray(items) ? [...new Set(items.filter(validId))].slice(0, max) : [];
    const form: unknown = value.sidebar;
    const width: unknown = value.sidebarWidth;
    const contextForm: unknown = value.context;
    const contextWidth: unknown = value.contextWidth;
    const tabs = ids(value.tabs, MAX_TABS);
    return {
      tabs,
      pinned: ids(value.pinned, MAX_TABS).filter((id) => tabs.includes(id)),
      recent: ids(value.recent, 50),
      favorites: ids(value.favorites, 500),
      sidebar: form === "rail" || form === "hidden" ? form : "expanded",
      sidebarWidth:
        typeof width === "number" && Number.isFinite(width) ? clampSidebarWidth(width) : null,
      context: contextForm === "expanded" ? "expanded" : "hidden",
      contextWidth:
        typeof contextWidth === "number" && Number.isFinite(contextWidth)
          ? clampContextWidth(contextWidth)
          : null,
    };
  } catch {
    return emptyWorkbench();
  }
}
/** 侧栏宽度夹到 [SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH] 的整像素值。 */
export function clampSidebarWidth(value: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(value)));
}
/** 上下文栏宽度夹到 [CONTEXT_MIN_WIDTH, CONTEXT_MAX_WIDTH] 的整像素值。 */
export function clampContextWidth(value: number): number {
  return Math.min(CONTEXT_MAX_WIDTH, Math.max(CONTEXT_MIN_WIDTH, Math.round(value)));
}
/** 切换侧栏形态；形态未变时返回原对象，避免无谓的持久化写入。 */
export function setSidebar(state: WorkbenchState, sidebar: SidebarForm): WorkbenchState {
  return state.sidebar === sidebar ? state : { ...state, sidebar };
}
/** 记住侧栏宽度；null 回到流体默认，数值未变时返回原对象。 */
export function setSidebarWidth(
  state: WorkbenchState,
  sidebarWidth: number | null,
): WorkbenchState {
  const width = sidebarWidth === null ? null : clampSidebarWidth(sidebarWidth);
  return state.sidebarWidth === width ? state : { ...state, sidebarWidth: width };
}
/** 切换上下文栏形态；形态未变时返回原对象。 */
export function setContext(state: WorkbenchState, context: ContextForm): WorkbenchState {
  return state.context === context ? state : { ...state, context };
}
/** 记住上下文栏宽度；null 回到流体默认，数值未变时返回原对象。 */
export function setContextWidth(
  state: WorkbenchState,
  contextWidth: number | null,
): WorkbenchState {
  const width = contextWidth === null ? null : clampContextWidth(contextWidth);
  return state.contextWidth === width ? state : { ...state, contextWidth: width };
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
