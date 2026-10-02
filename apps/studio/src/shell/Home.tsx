import { Kbd, StatusDot, useRunningApps } from "@bcr/react";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, ChevronDown, Shapes } from "lucide-react";
import { useStudio } from "../useStudio";
import {
  HOME_SECTIONS,
  LAUNCH_PAD_APPS,
  MORE_TOOL_SECTIONS,
  launchShortcut,
  type RegisteredApp,
} from "./registry";

/** A compact launch pad for everyday work; runtime and experimental tools are secondary. */
export function Home() {
  const studioRunning = useStudio((state) => state.runningCount);
  const activity = useRunningApps();
  const runningCount = (id: string) => (id === "studio" ? studioRunning : (activity[id] ?? 0));
  const moreTools = MORE_TOOL_SECTIONS.flatMap((group) => group.apps);
  const moreRunning = moreTools.reduce((count, app) => count + runningCount(app.id), 0);

  function appLink(app: RegisteredApp, auxiliary = false) {
    const running = runningCount(app.id);
    const shortcut = launchShortcut(app.id);
    return (
      <Link
        key={app.id}
        to={app.path}
        className={auxiliary ? "home-tool-link" : "home-app-card"}
        aria-label={`打开 ${app.title}`}
        aria-keyshortcuts={shortcut}
        title={shortcut === undefined ? app.title : `${app.title}（${shortcut}）`}
        data-app-id={app.id}
      >
        <span className="home-app-icon" aria-hidden="true">
          <app.icon />
        </span>
        <span className="home-app-copy">
          <span className="home-app-title">{app.title}</span>
          <span className="home-app-description">{app.description}</span>
          {running > 0 && (
            <span className="home-app-activity" role="status">
              <StatusDot status="running" />
              {running} 项任务运行中
            </span>
          )}
        </span>
        <span className="home-app-access" aria-hidden="true">
          <ArrowUpRight className="home-app-arrow" />
          {shortcut !== undefined && <Kbd>{shortcut}</Kbd>}
        </span>
      </Link>
    );
  }

  return (
    <main className="studio-home" aria-labelledby="home-title">
      <div className="studio-home-inner">
        <header className="home-heading">
          <div>
            <h1 id="home-title">工作区</h1>
            <p>选择工作区，继续研究、阅读与创作。</p>
          </div>
          <span className="home-workspace-count">{LAUNCH_PAD_APPS.length} 个工作区</span>
        </header>

        <div className="home-workspaces">
          {HOME_SECTIONS.filter((group) => group.apps.length > 0).map((group) => (
            <section className="home-section" key={group.id} aria-labelledby={`home-${group.id}`}>
              <h2 id={`home-${group.id}`}>{group.title}</h2>
              <div className="home-app-grid">{group.apps.map((app) => appLink(app))}</div>
            </section>
          ))}
        </div>

        <details
          className="home-more-tools"
          onToggle={(event) => {
            if (event.currentTarget.open) event.currentTarget.scrollIntoView({ block: "nearest" });
          }}
        >
          <summary>
            <Shapes className="home-more-icon" aria-hidden="true" />
            <span className="home-more-label">更多工具</span>
            <span className="home-more-description">实验与开发 · {moreTools.length}</span>
            {moreRunning > 0 && (
              <span className="home-app-activity" role="status">
                <StatusDot status="running" />
                {moreRunning} 项运行中
              </span>
            )}
            <ChevronDown className="home-more-chevron" aria-hidden="true" />
          </summary>
          <div className="home-tool-groups">
            {MORE_TOOL_SECTIONS.filter((group) => group.apps.length > 0).map((group) => (
              <section key={group.id} aria-labelledby={`home-${group.id}`}>
                <h2 id={`home-${group.id}`}>{group.title}</h2>
                <div className="home-tool-list">{group.apps.map((app) => appLink(app, true))}</div>
              </section>
            ))}
          </div>
        </details>
      </div>
    </main>
  );
}
