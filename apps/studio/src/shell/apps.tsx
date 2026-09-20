import {
  AudioWaveform,
  BookOpenText,
  ChartCandlestick,
  FileBadge,
  FileStack,
  Globe2,
  LayoutGrid,
  LibraryBig,
  NotebookPen,
  Table2,
  type LucideIcon,
} from "lucide-react";
import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import { Dock } from "../components/Dock";

/**
 * App 注册表（OS 式 Shell）：每个 App 一条路由、一个懒加载组件。
 * 领域 App 经 workspace 包源码挂载，首次进入才加载对应 chunk。
 */
export interface AppDef {
  readonly id:
    | "studio"
    | "media"
    | "quant"
    | "markets"
    | "manga"
    | "documents"
    | "reader"
    | "data"
    | "docgen"
    | "knowledge";
  readonly title: string;
  readonly path:
    | "/studio"
    | "/media"
    | "/quant"
    | "/markets"
    | "/manga"
    | "/documents"
    | "/reader"
    | "/data"
    | "/docgen"
    | "/knowledge";
  readonly icon: LucideIcon;
  readonly description: string;
  /**
   * Label for the command palette, when the card title alone is ambiguous.
   *
   * Palette entries are searched by substring, so a bare "Studio" competes with
   * "Media Studio" and "Manga Studio"; the host app keeps its card title but
   * advertises a more specific command name.
   */
  readonly paletteTitle?: string;
  /**
   * Where the app belongs on the launch pad.
   *
   * `null` keeps the route registered and reachable by URL — `appIdFromPath`
   * resolves it and the Shell keeps it alive — without advertising it as a
   * product surface. DocGen Lab uses this: it is an internal fixture generator
   * for bill samples, not one of the vertical slices the project ships.
   */
  readonly section: "compute" | "personal" | null;
  readonly component: ComponentType | LazyExoticComponent<ComponentType>;
}

export const APPS: ReadonlyArray<AppDef> = [
  {
    id: "studio",
    title: "Studio",
    path: "/studio",
    icon: LayoutGrid,
    description: "Compute Runtime 工作台 · 文件 / 任务 / 缓存血缘",
    paletteTitle: "Studio 工作台",
    section: "compute",
    component: Dock,
  },
  {
    id: "media",
    title: "Media Studio",
    path: "/media",
    icon: AudioWaveform,
    description: "本地语音转字幕 · Whisper ASR / 双语翻译 / SRT·VTT·ASS 导出",
    section: "compute",
    component: lazy(() => import("@bcr/media-studio/app").then((m) => ({ default: m.App }))),
  },
  {
    id: "quant",
    title: "Quant Lab",
    path: "/quant",
    icon: ChartCandlestick,
    description: "本地策略研究 · OHLCV / SMA 信号 / 回测权益 / 成交分析",
    section: "compute",
    component: lazy(() => import("@bcr/quant-lab/app").then((m) => ({ default: m.App }))),
  },
  {
    id: "markets",
    title: "Market Atlas",
    path: "/markets",
    icon: Globe2,
    description: "全球市场脉搏 · 5K+ A 股广度 / 板块热图 / 排行 · 实时行情，离线回退缓存与演示数据",
    section: "compute",
    component: lazy(() => import("@bcr/market-board/app").then((m) => ({ default: m.App }))),
  },
  {
    id: "manga",
    title: "Manga Studio",
    path: "/manga",
    icon: BookOpenText,
    description: "漫画翻译工作台 · OCR / 翻译 / 清理 / CJK 排版审校",
    section: "compute",
    component: lazy(() => import("@bcr/manga-studio/app").then((m) => ({ default: m.App }))),
  },
  {
    id: "documents",
    title: "Document Studio",
    path: "/documents",
    icon: FileStack,
    description: "文档流水线入口 · Ingest / Extract / OCR / Translate / Handoff · DOCX",
    section: "compute",
    component: lazy(() => import("@bcr/document-studio/app").then((m) => ({ default: m.App }))),
  },
  {
    id: "reader",
    title: "Reader Studio",
    path: "/reader",
    icon: LibraryBig,
    description: "本地阅读空间 · TXT / Markdown / HTML / DOCX / EPUB / PDF / CBZ · 进度与全文搜索",
    section: "compute",
    component: lazy(() => import("@bcr/reader-studio/app").then((m) => ({ default: m.App }))),
  },
  {
    id: "data",
    title: "Data Studio",
    path: "/data",
    icon: Table2,
    description: "本地表格探索 · CSV / JSON / NDJSON · Schema / 搜索 / 导出",
    section: "compute",
    component: lazy(() => import("@bcr/data-studio/app").then((m) => ({ default: m.App }))),
  },
  {
    id: "docgen",
    title: "DocGen Lab",
    path: "/docgen",
    icon: FileBadge,
    description: "虚构账单生成 · 模板渲染 / 水印 / 实拍合成 · 纯端侧",
    section: null,
    component: lazy(() => import("@bcr/docgen-studio/app").then((m) => ({ default: m.App }))),
  },
  {
    id: "knowledge",
    title: "个人知识库",
    path: "/knowledge",
    icon: NotebookPen,
    description: "独立 Markdown 笔记 · 资料引用 / 全文搜索 / GitHub 同步与版本恢复",
    section: "personal",
    component: lazy(() =>
      import("../knowledge/KnowledgeApp").then((m) => ({ default: m.KnowledgeApp })),
    ),
  },
];

export type ActiveView = "home" | AppDef["id"];

/**
 * Launch-pad entries in `Alt+1..9` order, split by where they belong.
 *
 * `Home` renders these groups; the Shell's `Alt+N` shortcuts and the launch-pad
 * key hints both index {@link LAUNCH_PAD_APPS}, so the printed shortcut and the
 * bound shortcut cannot disagree. The command palette deliberately walks the
 * full `APPS` list instead, which keeps URL-only routes such as `/docgen`
 * reachable without advertising them as product surfaces.
 */
export const COMPUTE_APPS: ReadonlyArray<AppDef> = APPS.filter((a) => a.section === "compute");
export const PERSONAL_APPS: ReadonlyArray<AppDef> = APPS.filter((a) => a.section === "personal");
export const LAUNCH_PAD_APPS: ReadonlyArray<AppDef> = APPS.filter((a) => a.section !== null);

export function appIdFromPath(pathname: string): ActiveView {
  const app = APPS.find((a) => pathname === a.path || pathname.startsWith(`${a.path}/`));
  return app?.id ?? "home";
}
