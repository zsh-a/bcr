import {
  Button,
  IconButton,
  StatusDot,
  formatBytes,
  useArtifactUsage,
  useRunningApps,
} from "@bcr/react";
import { useNavigate } from "@tanstack/react-router";
import { Bot, Command, House, RefreshCw, Search, Settings2 } from "lucide-react";
import { useId, useRef, useState } from "react";
import { MANIFESTS, type ActiveView } from "../shell/registry";
import { useStudio } from "../store";
import { ThemePicker } from "../theme/ThemePicker";

/** 高频搜索与助手常驻；命令、外观和运行状态归入工作区选项。 */
export function TopBar(props: {
  active: ActiveView;
  onOpenPalette: () => void;
  onOpenSearch: () => void;
  onOpenAgent: () => void;
}) {
  const navigate = useNavigate();
  const modifier = /Mac|iPhone|iPad/u.test(navigator.platform) ? "⌘" : "Ctrl";
  const studioRunning = useStudio((s) => s.runningCount);
  const activity = useRunningApps();
  const running = studioRunning + Object.values(activity).reduce((sum, count) => sum + count, 0);
  const taskTotal = useStudio((s) => s.tasks.length);
  const artifactUsage = useArtifactUsage();
  const activeApp = MANIFESTS.find((app) => app.id === props.active);
  const optionsId = useId();
  const optionsTrigger = useRef<HTMLButtonElement>(null);
  const options = useRef<HTMLDivElement>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const pool = Math.max(1, (navigator.hardwareConcurrency ?? 2) - 1);
  const usage = artifactUsage.status === "ready" ? artifactUsage.usage : undefined;
  const dot = artifactUsage.status === "error" ? "failed" : running > 0 ? "running" : "idle";

  return (
    <header className="studio-topbar">
      <IconButton
        label="返回工作区主页"
        title="返回主页（Alt+0）"
        variant="ghost"
        className="studio-topbar-action"
        onClick={() => void navigate({ to: "/" })}
      >
        <House className="size-4" />
      </IconButton>

      <div className="studio-topbar-brand">
        <span className="studio-topbar-brand-copy">
          <span className="studio-topbar-product">
            BCR <span aria-hidden="true">/</span>{" "}
          </span>
          {activeApp?.title ?? "工作区"}
        </span>
      </div>

      <Button
        variant="ghost"
        size="lg"
        className="studio-topbar-action studio-topbar-search"
        onClick={props.onOpenSearch}
        title={`打开全局搜索（${modifier}⇧F）`}
        aria-label="打开全局搜索"
        aria-keyshortcuts="Control+Shift+F Meta+Shift+F"
      >
        <Search className="size-4" />
        <span className="studio-topbar-button-label">搜索工作区</span>
        <kbd className="studio-topbar-search-key">{modifier}⇧F</kbd>
      </Button>

      <Button
        variant="ghost"
        size="lg"
        className="studio-topbar-action"
        onClick={props.onOpenAgent}
        title={`打开 AI 助手（${modifier}J）`}
        aria-label="打开 AI 助手"
        aria-keyshortcuts="Control+J Meta+J"
      >
        <Bot className="size-4" />
        <span className="studio-topbar-button-label">AI 助手</span>
      </Button>

      <IconButton
        ref={optionsTrigger}
        label="工作区选项"
        variant="ghost"
        className="studio-topbar-action studio-options-trigger"
        popoverTarget={optionsId}
        aria-haspopup="dialog"
        aria-expanded={optionsOpen}
      >
        <Settings2 className="size-4" />
        {(running > 0 || artifactUsage.status === "error") && (
          <span className="studio-options-indicator">
            <StatusDot status={dot} />
          </span>
        )}
      </IconButton>
      <div
        ref={options}
        id={optionsId}
        popover="auto"
        role="dialog"
        aria-label="工作区选项"
        className="ui-popover studio-options-popover"
        onToggle={(event) => {
          if (event.target === event.currentTarget) setOptionsOpen(event.newState === "open");
        }}
      >
        <div className="studio-options-heading">工作区选项</div>
        <Button
          variant="ghost"
          className="studio-options-command"
          aria-label="打开命令面板"
          onClick={() => {
            options.current?.hidePopover();
            optionsTrigger.current?.focus();
            props.onOpenPalette();
          }}
        >
          <Command className="size-4" />
          <span>命令面板</span>
          {props.active !== "knowledge" && <kbd>{modifier}K</kbd>}
        </Button>
        <section className="studio-options-section" aria-label="外观设置">
          <h2>外观</h2>
          <ThemePicker />
        </section>
        <details className="studio-options-section studio-options-status">
          <summary className="studio-status-trigger">
            <StatusDot status={dot} />
            <span>存储与运行状态</span>
            {running > 0 && <small>{running} 项运行中</small>}
          </summary>
          <div className="studio-options-facts">
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
              title="刷新本地 Artifact 容量"
              aria-label="刷新本地 Artifact 容量"
            >
              <RefreshCw className="size-3" aria-hidden="true" />
              刷新
            </Button>
          </div>
        </details>
      </div>
    </header>
  );
}
