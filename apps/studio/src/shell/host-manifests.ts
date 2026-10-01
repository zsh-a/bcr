import { LayoutGrid, NotebookPen, Sparkles } from "lucide-react";
import type { AppManifest, PanelManifest } from "@bcr/shell-contract";
import { knowledgePlugin } from "../knowledge/plugin";

/**
 * Routes the Studio host itself owns.
 *
 * The domain apps declare themselves through their own `app-manifest.ts`;
 * these two live inside the host, so they are recorded here. The host app keeps
 * route-level search parsing in `../router.tsx`, where `useSelection` already
 * reads the same keys, so both stay defined next to their consumer.
 */

/**
 * 知识库在路由树里的 path，两处共用一个来源：
 * - 本文件 KNOWLEDGE_MANIFEST（宿主 /knowledge 嵌入路由）；
 * - knowledge/standalone.tsx（独立 PWA 入口的 route path，外面另有 basepath
 *   /notes 做 URL 隔离，别把两者当成同一层）。
 * 第三处声明在 KnowledgeApp.tsx 内部的硬编码导航（不归壳层管），改这里必须同步它。
 */
export const KNOWLEDGE_PATH = "/knowledge";

/**
 * 与 pwa/apps.ts 的安装清单是同一套应用的两份平行事实，靠取值巧合对齐：Shell.tsx
 * 拿这里的 manifest id 直接当 PWA key 查安装身份（pwaForApp(active)），首页路由
 * "/" 又叫 "home"，靠 pwaForApp 里 home→workspace 的字面映射找回 key "workspace"。
 * 也就是说同一个宿主工作区有三个名字——安装清单叫 key "workspace"、本清单叫
 * id "studio"（宿主包名 @bcr/studio）、路由叫 "/"——仅靠取值巧合保持一致，改名即断。
 * key/id/scope/startUrl 是已发布的安装身份，取值绝不能改（用户已安装的 PWA 靠它
 * 识别自己，改了会失去身份并被重复安装）；对应注释见 pwa/apps.ts 顶部。
 */
export const STUDIO_MANIFEST = {
  id: "studio",
  title: "Studio",
  // A bare "Studio" competes with Media/Manga Studio in substring search.
  paletteTitle: "Studio 工作台",
  path: "/studio",
  icon: LayoutGrid,
  description: "查看文件、计算任务、缓存与本地存储",
  section: "developer",
  // Dock 必须走 load 惰性加载：静态 import 会把 Dock→面板→router 的模块图
  // 拉进 host-manifests，与 registry 形成环——打包后模块初始化交错，
  // registry 顶层会读到尚未初始化的 STUDIO_MANIFEST（启动即崩）。
  load: async () => ({ App: (await import("../components/Dock")).Dock }),
} as const satisfies AppManifest;

export const KNOWLEDGE_MANIFEST = {
  plugins: [knowledgePlugin],
  id: "knowledge",
  title: "个人知识库",
  path: KNOWLEDGE_PATH,
  icon: NotebookPen,
  description: "记录想法，管理资料与关联阅读引用",
  section: "reading",
  load: async () => ({ App: (await import("../knowledge/KnowledgeApp")).KnowledgeApp }),
} as const satisfies AppManifest;

export const ASSISTANT_PANEL = {
  kind: "panel",
  id: "assistant",
  title: "AI 助手",
  icon: Sparkles,
  description: "全局浮动助手 · 共享领域能力 · 工具执行与审批",
  section: null,
} as const satisfies PanelManifest;
