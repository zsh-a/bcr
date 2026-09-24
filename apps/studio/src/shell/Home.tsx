import { Kbd, SectionLabel, StatusDot, useRunningApps } from "@bcr/react";
import { useNavigate } from "@tanstack/react-router";
import { useStudio } from "../store";
import { COMPUTE_APPS, LAUNCH_PAD_APPS, PERSONAL_APPS, type LaunchEntry } from "./registry";

/**
 * 启动台（OS 主页面）：App 图标网格 + 运行中任务角标。
 * 领域应用主动发布运行状态，启动台只读取通用状态投影。
 *
 * 分区呈现：「计算工作台」是本项目对外声明的垂直切片，「个人空间」是
 * 信息管理类 surface。DocGen Lab 属内部合成数据工具，不在启动台展示
 * （路由仍可用，命令面板可达）。
 */
export function Home({ onOpenPanel }: { onOpenPanel: (id: string) => void }) {
  const navigate = useNavigate();
  const studioRunning = useStudio((s) => s.runningCount);
  const activity = useRunningApps();

  const runningBadge = (id: string): number => {
    if (id === "studio") return studioRunning;
    return activity[id] ?? 0;
  };

  const card = (app: LaunchEntry) => {
    const running = runningBadge(app.id);
    // Shortcut number follows the launch pad, not the registry order.
    const shortcut = LAUNCH_PAD_APPS.indexOf(app) + 1;
    return (
      <button
        key={app.id}
        type="button"
        onClick={() =>
          app.kind === "panel" ? onOpenPanel(app.id) : void navigate({ to: app.path })
        }
        className="home-app-card group relative flex min-h-56 flex-col items-start justify-between gap-6 p-7 text-left"
      >
        <span className="flex size-14 items-center justify-center rounded-sm border border-border bg-overlay text-accent">
          <app.icon className="size-6" />
        </span>
        <span>
          <span className="block text-xl font-medium text-text">{app.title}</span>
          <span className="mt-2 block max-w-sm text-base text-muted">{app.description}</span>
        </span>
        <Kbd>{shortcut <= 9 ? `Alt+${shortcut}` : "⌘K"}</Kbd>
        {running > 0 && (
          <span className="absolute top-5 right-5 inline-flex items-center gap-2 font-mono text-xs text-accent">
            <StatusDot status="running" />
            {running} running
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="studio-home h-full overflow-y-auto px-8 py-12">
      <div className="studio-home-inner mx-auto flex flex-col gap-12">
        <div className="max-w-3xl">
          <SectionLabel>LOCAL-FIRST COMPUTE SUITE</SectionLabel>
          <h1 className="mt-4 font-display text-2xl font-medium text-text">BCR Workspace</h1>
          <p className="mt-5 max-w-2xl text-base text-muted">
            一个驻留在浏览器中的计算工作站，让数据、媒体、量化研究与全球市场在同一运行时中流动。
          </p>
          <p className="mt-3 font-mono text-xs text-faint">
            browser compute runtime · 本地计算工作站 · Alt+数字 快速切换 · Alt+0 回到这里
          </p>
        </div>

        <section className="flex flex-col gap-5">
          <SectionLabel>COMPUTE WORKSPACES</SectionLabel>
          <div className="home-app-grid grid grid-cols-2 gap-5">{COMPUTE_APPS.map(card)}</div>
        </section>

        <section className="flex flex-col gap-5">
          <SectionLabel>PERSONAL</SectionLabel>
          <div className="home-app-grid grid grid-cols-2 gap-5">{PERSONAL_APPS.map(card)}</div>
        </section>
      </div>
    </div>
  );
}
