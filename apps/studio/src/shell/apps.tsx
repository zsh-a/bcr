import { AudioWaveform, LayoutGrid, type LucideIcon } from "lucide-react";
import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import { Dock } from "../components/Dock";

/**
 * App 注册表（OS 式 Shell）：每个 App 一条路由、一个懒加载组件。
 * media 经 workspace 包源码挂载（@bcr/media-studio/app），首次进入才加载 chunk。
 */
export interface AppDef {
  readonly id: "studio" | "media";
  readonly title: string;
  readonly path: "/studio" | "/media";
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
];

export type ActiveView = "home" | AppDef["id"];

export function appIdFromPath(pathname: string): ActiveView {
  const app = APPS.find((a) => pathname === a.path || pathname.startsWith(`${a.path}/`));
  return app?.id ?? "home";
}
