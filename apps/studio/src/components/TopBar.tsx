import {
  Button,
  IconButton,
  Spinner,
  StatusDot,
  formatBytes,
  useArtifactUsage,
  useRunningApps,
} from "@bcr/react";
import { useNavigate } from "@tanstack/react-router";
import {
  Bot,
  Command,
  Cpu,
  HardDrive,
  House,
  RefreshCw,
  Search,
  SquareTerminal,
} from "lucide-react";
import { MANIFESTS, type ActiveView } from "../shell/registry";
import { useStudio } from "../store";
import { ThemePicker } from "../theme/ThemePicker";

/** 顶部工具栏（--h-topbar）：⌂ 返回主页 / 当前 App / 运行状态 / 快速操作；主题与背景归拢最右。 */
export function TopBar(props: {
  active: ActiveView;
  onOpenPalette: () => void;
  onOpenSearch: () => void;
  onOpenAgent: () => void;
}) {
  const navigate = useNavigate();
  const studioRunning = useStudio((s) => s.runningCount);
  const activity = useRunningApps();
  const running = studioRunning + Object.values(activity).reduce((sum, count) => sum + count, 0);
  const taskTotal = useStudio((s) => s.tasks.length);
  const artifactUsage = useArtifactUsage();
  const activeApp = MANIFESTS.find((app) => app.id === props.active);

  return (
    <header className="studio-topbar flex shrink-0 items-center gap-4 border-b border-border bg-bg px-5">
      <IconButton
        label="返回工作区主页"
        title="返回主页（Alt+0）"
        variant={props.active === "home" ? "ghost" : "default"}
        className="studio-topbar-action"
        onClick={() => void navigate({ to: "/" })}
      >
        <House className="size-4" />
      </IconButton>

      <div className="studio-topbar-brand flex min-w-0 shrink items-center gap-2.5">
        <SquareTerminal className="size-5 shrink-0 text-accent" />
        <span className="studio-topbar-brand-copy min-w-0 truncate text-base font-semibold">
          BCR<span className="text-faint"> / </span>
          <span className="text-muted">{activeApp?.title ?? "Home"}</span>
        </span>
      </div>

      <div className="h-6 w-px shrink-0 bg-border" />

      <span className="studio-runtime-label ui-section-label">BROWSER COMPUTE RUNTIME</span>

      <div className="flex-1" />

      {running > 0 && (
        <span className="inline-flex items-center gap-2 font-mono text-xs text-accent">
          <StatusDot status="running" />
          {running} running
        </span>
      )}
      <span className="studio-system-status inline-flex items-center gap-2 font-mono text-xs text-faint">
        <Cpu className="size-4" />
        wasm · pool {Math.max(1, (navigator.hardwareConcurrency ?? 2) - 1)} · {taskTotal} tasks
      </span>

      <Button
        variant="ghost"
        size="lg"
        className="studio-storage-status"
        onClick={artifactUsage.refresh}
        title="刷新本地 Artifact 容量"
        aria-label="刷新本地 Artifact 容量"
      >
        <HardDrive className="size-4" />
        <span className="font-mono text-xs">
          {artifactUsage.status === "ready" && artifactUsage.usage !== undefined ? (
            <span>
              {formatBytes(artifactUsage.usage.totalBytes)} · {artifactUsage.usage.totalObjects}{" "}
              objects
            </span>
          ) : artifactUsage.status === "error" ? (
            <span className="text-danger">storage unavailable</span>
          ) : (
            <span>scanning storage</span>
          )}
        </span>
        {artifactUsage.status === "loading" ? (
          <Spinner size="sm" label="正在扫描存储" />
        ) : (
          <RefreshCw className="size-3" aria-hidden="true" />
        )}
      </Button>

      <Button
        variant="default"
        size="lg"
        className="studio-topbar-action"
        onClick={props.onOpenSearch}
        title="打开全局搜索（⌘⇧F）"
        aria-label="打开全局搜索"
        aria-keyshortcuts="Control+Shift+F"
      >
        <Search className="size-4" />
        <span className="studio-topbar-button-label font-mono text-xs">搜索</span>
      </Button>

      <Button
        variant="default"
        size="lg"
        className="studio-topbar-action"
        onClick={props.onOpenAgent}
        title="打开 AI 助手（⌘J）"
        aria-label="打开 AI 助手"
        aria-keyshortcuts="Control+J"
      >
        <Bot className="size-4" />
        <span className="studio-topbar-button-label font-mono text-xs">AI</span>
      </Button>

      <Button
        variant="default"
        size="lg"
        className="studio-topbar-action"
        onClick={props.onOpenPalette}
        title="命令面板（⌘K）"
        aria-label="打开命令面板"
      >
        <Command className="size-4" />
        <span className="studio-topbar-button-label font-mono text-xs">⌘K</span>
      </Button>

      <ThemePicker />
    </header>
  );
}
