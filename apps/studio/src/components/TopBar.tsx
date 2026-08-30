import { Command, Cpu, SquareTerminal } from "lucide-react";
import { useStudio } from "../store";

/** 顶部工具栏：品牌 / 运行中任务指示 / 命令面板入口。 */
export function TopBar(props: { onOpenPalette: () => void }) {
  const running = useStudio((s) => s.runningCount);
  const taskTotal = useStudio((s) => s.tasks.length);

  return (
    <header className="flex h-10 shrink-0 items-center gap-3 border-b border-border bg-bg px-3">
      <div className="flex items-center gap-2">
        <SquareTerminal className="size-4 text-accent" />
        <span className="text-[12px] font-semibold tracking-[0.02em]">
          BCR<span className="text-faint"> / </span>
          <span className="text-muted">Studio</span>
        </span>
      </div>

      <div className="h-4 w-px bg-border" />

      <span className="font-mono text-[10px] text-faint">
        browser compute runtime · media-studio
      </span>

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
