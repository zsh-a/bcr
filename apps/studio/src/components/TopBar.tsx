import {
  Button,
  IconButton,
  StatusDot,
  formatBytes,
  useArtifactUsage,
  useRunningApps,
} from "@bcr/react";
import { useNavigate } from "@tanstack/react-router";
import { Bot, Command, House, RefreshCw, Search, SquareTerminal } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
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
  const telemetryId = useId();
  const telemetryTrigger = useRef<HTMLButtonElement>(null);
  const telemetryPop = useRef<HTMLDivElement>(null);
  const [telemetryOpen, setTelemetryOpen] = useState(false);
  const pool = Math.max(1, (navigator.hardwareConcurrency ?? 2) - 1);
  const usage = artifactUsage.status === "ready" ? artifactUsage.usage : undefined;
  const dot = artifactUsage.status === "error" ? "failed" : running > 0 ? "running" : "idle";
  // 浮层开合状态仅用于 aria-expanded；关闭后焦点若掉回 body，归还给触发器。
  useEffect(() => {
    const element = telemetryPop.current;
    if (!element) return;
    const toggle = () => {
      const shown = element.matches(":popover-open");
      setTelemetryOpen(shown);
      if (!shown && document.activeElement === document.body) telemetryTrigger.current?.focus();
    };
    element.addEventListener("toggle", toggle);
    return () => element.removeEventListener("toggle", toggle);
  }, []);

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

      <div className="flex-1" />

      {running > 0 && (
        <span className="inline-flex items-center gap-2 font-mono text-xs text-accent">
          <StatusDot status="running" />
          {running} running
        </span>
      )}

      <button
        ref={telemetryTrigger}
        type="button"
        className="studio-status-trigger"
        popoverTarget={telemetryId}
        aria-expanded={telemetryOpen}
        title="浏览器运行时与存储状态"
      >
        <StatusDot status={dot} />
        <span className="studio-status-line font-mono text-xs">wasm · {taskTotal} tasks</span>
      </button>
      <div
        ref={telemetryPop}
        id={telemetryId}
        popover="auto"
        className="ui-popover studio-telemetry-popover"
      >
        <dl className="studio-telemetry-facts">
          <div>
            <dt>运行时</dt>
            <dd>wasm · pool {pool}</dd>
          </div>
          <div>
            <dt>任务</dt>
            <dd>
              {taskTotal} tasks · {running} running
            </dd>
          </div>
        </dl>
        <Button
          variant="ghost"
          onClick={artifactUsage.refresh}
          title="刷新本地 Artifact 容量"
          aria-label="刷新本地 Artifact 容量"
        >
          <RefreshCw className="size-3" aria-hidden="true" />
          刷新 Artifact 容量
        </Button>
        <dl className="studio-telemetry-facts">
          {usage !== undefined ? (
            <>
              <div>
                <dt>容量</dt>
                <dd>{formatBytes(usage.totalBytes)}</dd>
              </div>
              <div>
                <dt>对象</dt>
                <dd>{usage.totalObjects} objects</dd>
              </div>
            </>
          ) : (
            <div>
              <dt>容量</dt>
              <dd className={artifactUsage.status === "error" ? "text-danger" : ""}>
                {artifactUsage.status === "error" ? "storage unavailable" : "scanning storage"}
              </dd>
            </div>
          )}
        </dl>
        <Button
          variant="ghost"
          onClick={artifactUsage.refresh}
          title="刷新本地存储容量"
          aria-label="刷新本地存储容量"
        >
          <RefreshCw className="size-3" aria-hidden="true" />
          刷新
        </Button>
      </div>

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
