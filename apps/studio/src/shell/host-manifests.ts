import { hostDefinitions, KNOWLEDGE_PATH } from "./host-definitions";
export { KNOWLEDGE_PATH };
import { LayoutGrid, NotebookPen, Sparkles, Shapes, Code2 } from "lucide-react";
import type { AppManifest, PanelManifest } from "@bcr/shell-contract";
import { knowledgePlugin } from "../knowledge/plugin";
import { diagramPlugin } from "../diagram/plugin";
import { worksPlugin } from "../works/plugin";

export const WORKS_MANIFEST = {
  ...hostDefinitions.works,
  icon: Code2,
  plugins: [worksPlugin],
  validateSearch: (search: Record<string, unknown>) => ({
    work: typeof search.work === "string" ? search.work : undefined,
  }),
  load: async () => ({ App: (await import("../works/WorksApp")).WorksApp }),
} as const satisfies AppManifest;

export const STUDIO_MANIFEST = {
  ...hostDefinitions.studio,
  // A bare "Studio" competes with Media/Manga Studio in substring search.
  paletteTitle: "Studio 工作台",
  icon: LayoutGrid,
  // Dock 必须走 load 惰性加载：静态 import 会把 Dock→面板→router 的模块图
  // 拉进 host-manifests，与 registry 形成环——打包后模块初始化交错，
  // registry 顶层会读到尚未初始化的 STUDIO_MANIFEST（启动即崩）。
  load: async () => ({ App: (await import("../workbench/Dock")).Dock }),
} as const satisfies AppManifest;

export const KNOWLEDGE_MANIFEST = {
  ...hostDefinitions.knowledge,
  plugins: [knowledgePlugin],
  icon: NotebookPen,
  load: async () => ({ App: (await import("../knowledge/workbench/KnowledgeApp")).KnowledgeApp }),
} as const satisfies AppManifest;

export const ASSISTANT_PANEL = {
  kind: "panel",
  id: "assistant",
  title: "AI 助手",
  icon: Sparkles,
  description: "全局浮动助手 · 共享领域能力 · 工具执行与审批",
  section: null,
} as const satisfies PanelManifest;

export const DIAGRAM_MANIFEST = {
  ...hostDefinitions.diagram,
  icon: Shapes,
  plugins: [diagramPlugin],
  validateSearch: (search: Record<string, unknown>) => ({
    diagram: typeof search.diagram === "string" ? search.diagram : undefined,
  }),
  load: async () => ({ App: (await import("../diagram/DiagramApp")).DiagramApp }),
} as const satisfies AppManifest;
