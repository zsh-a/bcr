import { AudioWaveform, ChartCandlestick, LayoutGrid, type LucideIcon } from "lucide-react";
import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import { Dock } from "../components/Dock";

/**
 * App 注册表（OS 式 Shell）：每个 App 一条路由、一个懒加载组件。
 * 领域 App 经 workspace 包源码挂载，首次进入才加载对应 chunk。
 */
export interface AppDef {
  readonly id: "studio" | "media" | "quant";
  readonly title: string;
  readonly path: "/studio" | "/media" | "/quant";
  readonly icon: LucideIcon;
  readonly description: string;
  readonly component: ComponentType | LazyExoticComponent<ComponentType>;
}

export const APPS: ReadonlyArray<AppDef> = [
  {
    id: "studio",
    title: "Studio",
    path: "/studio",
    icon: LayoutGrid,
    description: "Compute Runtime 工作台 · 文件 / 任务 / 缓存血缘",
    component: Dock,
  },
  {
    id: "media",
    title: "Media Studio",
    path: "/media",
    icon: AudioWaveform,
    description: "本地语音转字幕 · Whisper ASR / 双语翻译 / SRT·VTT·ASS 导出",
    component: lazy(() => import("@bcr/media-studio/app").then((m) => ({ default: m.App }))),
  },
  {
    id: "quant",
    title: "Quant Lab",
    path: "/quant",
    icon: ChartCandlestick,
    description: "本地策略研究 · OHLCV / SMA 信号 / 回测权益 / 成交分析",
    component: lazy(() => import("@bcr/quant-lab/app").then((m) => ({ default: m.App }))),
  },
];

export type ActiveView = "home" | AppDef["id"];

export function appIdFromPath(pathname: string): ActiveView {
  const app = APPS.find((a) => pathname === a.path || pathname.startsWith(`${a.path}/`));
  return app?.id ?? "home";
}
