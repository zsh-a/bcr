import { useRunningApps } from "@bcr/react";
import { useNavigate } from "@tanstack/react-router";
import { useStudio } from "../store";
import { APPS } from "./apps";

/**
 * 启动台（OS 主页面）：App 图标网格 + 运行中任务角标。
 * 领域应用主动发布运行状态，启动台只读取通用状态投影。
 */
export function Home() {
  const navigate = useNavigate();
  const studioRunning = useStudio((s) => s.runningCount);
  const activity = useRunningApps();

  const runningBadge = (id: string): number => {
    if (id === "studio") return studioRunning;
    return activity[id] ?? 0;
  };

  return (
    <div className="studio-home h-full overflow-y-auto px-8 py-12">
      <div className="mx-auto flex max-w-5xl flex-col gap-12">
        <div className="max-w-3xl">
          <span className="font-mono text-[11px] tracking-[0.12em] text-accent">
            LOCAL-FIRST COMPUTE SUITE
          </span>
          <h1 className="mt-4 text-[clamp(42px,6vw,72px)] font-medium leading-[0.96] tracking-[-0.045em] text-text">
            BCR Workspace
          </h1>
          <p className="mt-5 max-w-2xl text-[15px] leading-7 text-muted">
            一个驻留在浏览器中的计算工作站，让数据、媒体、量化研究与全球市场在同一运行时中流动。
          </p>
          <p className="mt-3 font-mono text-[11px] tracking-[0.04em] text-faint">
            browser compute runtime · 本地计算工作站 · Alt+数字 快速切换 · Alt+0 回到这里
          </p>
        </div>

        <div className="home-app-grid grid grid-cols-2 gap-5">
          {APPS.map((app, index) => {
            const running = runningBadge(app.id);
            return (
              <button
                key={app.id}
                type="button"
                onClick={() => void navigate({ to: app.path })}
                className="home-app-card group relative flex min-h-56 flex-col items-start justify-between gap-6 rounded-[var(--radius-md)] border border-border bg-surface p-7 text-left transition-colors hover:border-border-strong hover:bg-raised"
              >
                <span className="flex size-14 items-center justify-center rounded-[var(--radius-sm)] border border-border bg-overlay text-accent">
                  <app.icon className="size-6" />
                </span>
                <span>
                  <span className="block text-[20px] font-medium tracking-[-0.02em] text-text">
                    {app.title}
                  </span>
                  <span className="mt-2 block max-w-sm text-[13px] leading-6 text-muted">
                    {app.description}
                  </span>
                </span>
                <kbd className="rounded-[var(--radius-xs)] border border-border px-2 py-1 font-mono text-[10px] text-faint">
                  Alt+{index + 1}
                </kbd>
                {running > 0 && (
                  <span className="absolute top-5 right-5 inline-flex items-center gap-2 font-mono text-[10px] text-accent">
                    <span className="size-1.5 rounded-full bg-accent pulse-dot" />
                    {running} running
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
