import { LayoutGrid, NotebookPen, Sparkles } from "lucide-react";
import type { AppManifest, PanelManifest } from "@bcr/shell-contract";
import { Dock } from "../components/Dock";
import { knowledgePlugin } from "../knowledge/plugin";

/**
 * Routes the Studio host itself owns.
 *
 * The domain apps declare themselves through their own `app-manifest.ts`;
 * these two live inside the host, so they are recorded here. The host app keeps
 * route-level search parsing in `../router.tsx`, where `useSelection` already
 * reads the same keys, so both stay defined next to their consumer.
 */

export const STUDIO_MANIFEST = {
  id: "studio",
  title: "Studio",
  // A bare "Studio" competes with Media/Manga Studio in substring search.
  paletteTitle: "Studio 工作台",
  path: "/studio",
  icon: LayoutGrid,
  description: "Compute Runtime 工作台 · 文件 / 任务 / 缓存血缘",
  section: "compute",
  load: async () => ({ App: Dock }),
} as const satisfies AppManifest;

export const KNOWLEDGE_MANIFEST = {
  plugins: [knowledgePlugin],
  id: "knowledge",
  title: "个人知识库",
  path: "/knowledge",
  icon: NotebookPen,
  description: "独立 Markdown 笔记 · 资料引用 / 全文搜索 / GitHub 同步与版本恢复",
  section: "personal",
  load: async () => ({ App: (await import("../knowledge/KnowledgeApp")).KnowledgeApp }),
} as const satisfies AppManifest;

export const ASSISTANT_PANEL = {
  kind: "panel",
  id: "assistant",
  title: "AI 助手",
  icon: Sparkles,
  description: "全局浮动助手 · 共享领域能力 · 工具执行与审批",
  section: "personal",
} as const satisfies PanelManifest;
