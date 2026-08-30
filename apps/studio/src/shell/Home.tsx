import { useStudio as useMediaStudio } from "@bcr/media-studio/store";
import { useNavigate } from "@tanstack/react-router";
import { useStudio } from "../store";
import { APPS } from "./apps";

/**
 * 启动台（OS 主页面）：App 图标网格 + 运行中任务角标。
 * App 本体常驻挂载，这里只读两边的 module 级 store 做概览。
 */
export function Home() {
  const navigate = useNavigate();
  const studioRunning = useStudio((s) => s.runningCount);
  const mediaRunning = useMediaStudio((s) => s.running);

  const runningBadge = (id: string): number =>
    id === "studio" ? studioRunning : mediaRunning ? 1 : 0;

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto flex max-w-2xl flex-col gap-6 pt-6">
        <div>
          <h1 className="text-[15px] font-semibold text-text">BCR Workspace</h1>
          <p className="mt-1 font-mono text-[10px] text-faint">
            browser compute runtime · 本地计算工作站 · Alt+数字 快速切换 · Alt+0 回到这里
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {APPS.map((app, index) => {
            const running = runningBadge(app.id);
            return (
              <button
                key={app.id}
                type="button"
                onClick={() => void navigate({ to: app.path })}
                className="group relative flex flex-col items-start gap-3 rounded-[var(--radius-md)] border border-border bg-surface p-4 text-left transition-colors hover:border-border-strong hover:bg-raised"
              >
                <span className="flex size-9 items-center justify-center rounded-[var(--radius-sm)] border border-border bg-overlay text-accent">
                  <app.icon className="size-4" />
                </span>
                <span>
                  <span className="block text-[12px] font-medium text-text">{app.title}</span>
                  <span className="mt-0.5 block text-[10px] leading-relaxed text-faint">
                    {app.description}
                  </span>
                </span>
                <kbd className="rounded-[var(--radius-xs)] border border-border px-1 font-mono text-[9px] text-faint">
                  Alt+{index + 1}
                </kbd>
                {running > 0 && (
                  <span className="absolute top-3 right-3 inline-flex items-center gap-1 font-mono text-[10px] text-accent">
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
