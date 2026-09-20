import { LayoutGrid, NotebookPen } from "lucide-react";
import type { AppManifest } from "@bcr/shell-contract";
import { Dock } from "../components/Dock";

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
  id: "knowledge",
  title: "个人知识库",
  path: "/knowledge",
  icon: NotebookPen,
  description: "独立 Markdown 笔记 · 资料引用 / 全文搜索 / GitHub 同步与版本恢复",
  section: "personal",
  load: async () => ({ App: (await import("../knowledge/KnowledgeApp")).KnowledgeApp }),
} as const satisfies AppManifest;
