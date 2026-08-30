import { useNavigate } from "@tanstack/react-router";
import { Command, Cpu, House, SquareTerminal } from "lucide-react";
import { APPS, type ActiveView } from "../shell/apps";
import { useStudio } from "../store";

/** 顶部工具栏：⌂ 返回主页 / 当前 App / 运行中任务指示 / 命令面板入口。 */
export function TopBar(props: { active: ActiveView; onOpenPalette: () => void }) {
  const navigate = useNavigate();
  const running = useStudio((s) => s.runningCount);
  const taskTotal = useStudio((s) => s.tasks.length);
  const activeApp = APPS.find((app) => app.id === props.active);

  return (
    <header className="flex h-10 shrink-0 items-center gap-3 border-b border-border bg-bg px-3">
      <button
        type="button"
        onClick={() => void navigate({ to: "/" })}
        title="返回主页（Alt+0）"
        className={`inline-flex size-6 items-center justify-center rounded-[var(--radius-sm)] border transition-colors ${
          props.active === "home"
            ? "border-border text-faint"
            : "border-border bg-raised text-muted hover:border-border-strong hover:text-text"
        }`}
      >
        <House className="size-3.5" />
      </button>

      <div className="flex items-center gap-2">
        <SquareTerminal className="size-4 text-accent" />
        <span className="text-[12px] font-semibold tracking-[0.02em]">
          BCR<span className="text-faint"> / </span>
          <span className="text-muted">{activeApp?.title ?? "Home"}</span>
        </span>
      </div>

      <div className="h-4 w-px bg-border" />

      <span className="font-mono text-[10px] text-faint">browser compute runtime</span>

      <div className="flex-1" />

      {running > 0 && (
        <span className="inline-flex items-center gap-1.5 font-mono text-[10px] text-accent">
          <span className="size-1.5 rounded-full bg-accent pulse-dot" />
          {running} running
        </span>
      )}
      <span className="inline-flex items-center gap-1.5 font-mono text-[10px] text-faint">
        <Cpu className="size-3" />
        wasm · pool {Math.max(1, (navigator.hardwareConcurrency ?? 2) - 1)} · {taskTotal} tasks
      </span>

      <button
        type="button"
        onClick={props.onOpenPalette}
        className="inline-flex h-6 items-center gap-1.5 rounded-[var(--radius-sm)] border border-border bg-raised px-2 text-[11px] text-muted transition-colors hover:border-border-strong hover:text-text"
      >
        <Command className="size-3" />
        <span className="font-mono text-[10px]">⌘K</span>
      </button>
    </header>
  );
}
