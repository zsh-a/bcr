import { useArtifactUsage } from "@bcr/react";
import { useStudio as useMediaStudio } from "@bcr/media-studio/store";
import { useQuantLab } from "@bcr/quant-lab/store";
import { useMangaStudio } from "@bcr/manga-studio/store";
import { useNavigate } from "@tanstack/react-router";
import { Command, Cpu, HardDrive, House, RefreshCw, SquareTerminal } from "lucide-react";
import { APPS, type ActiveView } from "../shell/apps";
import { useStudio } from "../store";
import { formatBytes } from "./ui";

/** 顶部工具栏：⌂ 返回主页 / 当前 App / 运行中任务指示 / 命令面板入口。 */
export function TopBar(props: { active: ActiveView; onOpenPalette: () => void }) {
  const navigate = useNavigate();
  const studioRunning = useStudio((s) => s.runningCount);
  const mediaRunning = useMediaStudio((s) => s.running);
  const quantRunning = useQuantLab((s) => s.running);
  const mangaRunning = useMangaStudio((s) => s.running);
  const running =
    studioRunning + (mediaRunning ? 1 : 0) + (quantRunning ? 1 : 0) + (mangaRunning ? 1 : 0);
  const taskTotal = useStudio((s) => s.tasks.length);
  const artifactUsage = useArtifactUsage();
  const activeApp = APPS.find((app) => app.id === props.active);

  return (
    <header className="studio-topbar flex h-16 shrink-0 items-center gap-4 border-b border-border bg-bg px-5">
      <button
        type="button"
        onClick={() => void navigate({ to: "/" })}
        title="返回主页（Alt+0）"
        aria-label="返回工作区主页"
        className={`inline-flex size-11 items-center justify-center rounded-[var(--radius-sm)] border transition-colors ${
          props.active === "home"
            ? "border-border text-faint"
            : "border-border bg-raised text-muted hover:border-border-strong hover:text-text"
        }`}
      >
        <House className="size-4" />
      </button>

      <div className="flex items-center gap-2.5">
        <SquareTerminal className="size-5 text-accent" />
        <span className="text-[14px] font-semibold tracking-[0.02em]">
          BCR<span className="text-faint"> / </span>
          <span className="text-muted">{activeApp?.title ?? "Home"}</span>
        </span>
      </div>

      <div className="h-6 w-px bg-border" />

      <span className="studio-runtime-label font-mono text-[11px] tracking-[0.08em] text-faint">
        BROWSER COMPUTE RUNTIME
      </span>

      <div className="flex-1" />

      {running > 0 && (
        <span className="inline-flex items-center gap-2 font-mono text-[11px] text-accent">
          <span className="size-1.5 rounded-full bg-accent pulse-dot" />
          {running} running
        </span>
      )}
      <span className="studio-system-status inline-flex items-center gap-2 font-mono text-[11px] text-faint">
        <Cpu className="size-4" />
        wasm · pool {Math.max(1, (navigator.hardwareConcurrency ?? 2) - 1)} · {taskTotal} tasks
      </span>

      <button
        type="button"
        onClick={artifactUsage.refresh}
        title="刷新本地 Artifact 容量"
        aria-label="刷新本地 Artifact 容量"
        className="studio-storage-status inline-flex h-10 items-center gap-2 rounded-[var(--radius-sm)] border border-border px-2.5 font-mono text-[11px] text-faint transition-colors hover:border-border-strong hover:text-text"
      >
        <HardDrive className="size-4" />
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
        <RefreshCw
          className={`size-3 ${artifactUsage.status === "loading" ? "animate-spin" : ""}`}
        />
      </button>

      <button
        type="button"
        onClick={props.onOpenPalette}
        aria-label="打开命令面板"
        className="inline-flex h-11 items-center gap-2 rounded-[var(--radius-sm)] border border-border bg-raised px-3 text-[12px] text-muted transition-colors hover:border-border-strong hover:text-text"
      >
        <Command className="size-4" />
        <span className="font-mono text-[11px]">⌘K</span>
      </button>
    </header>
  );
}
