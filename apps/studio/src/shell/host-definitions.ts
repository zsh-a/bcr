import type { AppDefinition } from "@bcr/shell-contract";
export const KNOWLEDGE_PATH = "/knowledge";
export const hostDefinitions = {
  workspace: {
    id: "workspace",
    title: "工作区",
    path: "/",
    description: "本地工作区",
    section: null,
    installation: {
      name: "BCR Workspace",
      shortName: "工作区",
      entry: "src/studio-main.tsx",
      boot: "workspace",
    },
  },
  studio: {
    id: "studio",
    title: "Studio",
    displayTitle: "计算工作台",
    path: "/studio",
    description: "查看文件、计算任务、缓存与本地存储",
    section: "developer",
    installation: {
      name: "BCR Studio",
      shortName: "计算工作台",
      entry: "src/studio-main.tsx",
      boot: "workspace",
    },
  },
  knowledge: {
    id: "knowledge",
    title: "个人知识库",
    path: KNOWLEDGE_PATH,
    description: "记录想法，管理资料与关联阅读引用",
    section: "reading",
    installation: {
      name: "BCR 笔记",
      shortName: "笔记",
      entry: "notes/knowledge/index.html",
      boot: "knowledge",
    },
  },
  diagram: {
    id: "diagram",
    title: "绘图",
    path: "/diagram",
    description: "绘制流程与架构，让 AI 协助生成和修改",
    section: "reading",
    installation: {
      name: "BCR 绘图",
      shortName: "绘图",
      entry: "src/diagram/DiagramApp.tsx",
      boot: "independent",
    },
  },
} as const satisfies Record<string, AppDefinition>;
