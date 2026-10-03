import { Kbd, StatusDot, useRunningApps, useRuntime, useNavigation } from "@bcr/react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, ChevronDown, Clock3, Shapes } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStudio } from "../useStudio";
import { recentWorkspaceDocument, type RecentWorkspace } from "./recent-workspaces";
import {
  HOME_SECTIONS,
  LAUNCH_PAD_APPS,
  MORE_TOOL_SECTIONS,
  MANIFESTS,
  launchShortcut,
  type RegisteredApp,
} from "./registry";

/** A compact launch pad for everyday work; runtime and experimental tools are secondary. */
export function Home({ active, recent }: { active: boolean; recent: readonly RecentWorkspace[] }) {
  const root = useRef<HTMLElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);
  const lastFocusTop = useRef<number | null>(null);
  const scroll = useRef(0);
  const { search } = useRuntime();
  const navigation = useNavigation();
  const [revision, refresh] = useState(0);
  useEffect(() => {
    if (active) return search?.subscribe(() => refresh((value) => value + 1));
  }, [active, search]);
  const documents = useMemo(
    () => (active ? (search?.documents() ?? []) : []),
    [active, search, revision],
  );
  useLayoutEffect(() => {
    if (!active || !root.current) return;
    root.current.scrollTop = scroll.current;
    if (lastFocus.current && lastFocusTop.current !== null) {
      root.current.scrollTop +=
        lastFocus.current.getBoundingClientRect().top - lastFocusTop.current;
    }
    lastFocus.current?.focus({ preventScroll: true });
  }, [active]);
  const recentItems = recent.slice(0, 3).flatMap((entry) => {
    const app = MANIFESTS.find((item) => item.id === entry.appId);
    return app ? [{ entry, app, document: recentWorkspaceDocument(entry, app, documents) }] : [];
  });
  const studioRunning = useStudio((state) => state.runningCount);
  const activity = useRunningApps();
  const runningCount = (id: string) => (id === "studio" ? studioRunning : (activity[id] ?? 0));
  const moreTools = MORE_TOOL_SECTIONS.flatMap((group) => group.apps);
  const moreRunning = moreTools.reduce((count, app) => count + runningCount(app.id), 0);

  function appLink(app: RegisteredApp, auxiliary = false) {
    const running = runningCount(app.id);
    const shortcut = launchShortcut(app.id);
    const title = app.displayTitle ?? app.title;
    return (
      <Link
        key={app.id}
        to={app.path}
        className={auxiliary ? "home-tool-link" : "home-app-card"}
        aria-label={`打开 ${title}`}
        aria-keyshortcuts={shortcut}
        title={shortcut === undefined ? app.title : `${app.title}（${shortcut}）`}
        data-app-id={app.id}
      >
        <span className="home-app-icon" aria-hidden="true">
          <app.icon />
        </span>
        <span className="home-app-copy">
          <span className="home-app-title">{title}</span>
          <span className="home-app-description">{app.description}</span>
          {running > 0 && (
            <span className="home-app-activity" role="status">
              <StatusDot status="running" />
              {running} 项任务运行中
            </span>
          )}
        </span>
        <span className="home-app-access" aria-hidden="true">
          <ArrowRight className="home-app-arrow" />
          {shortcut !== undefined && <Kbd>{shortcut}</Kbd>}
        </span>
      </Link>
    );
  }

  return (
    <main
      ref={root}
      className="studio-home"
      aria-labelledby="home-title"
      onScroll={(event) => {
        if (active) scroll.current = event.currentTarget.scrollTop;
      }}
      onFocusCapture={(event) => {
        lastFocus.current = event.target;
        lastFocusTop.current = event.target.getBoundingClientRect().top;
      }}
      onClickCapture={(event) => {
        const target = (event.target as HTMLElement).closest<HTMLElement>("a,button,summary");
        if (target) {
          lastFocus.current = target;
          lastFocusTop.current = target.getBoundingClientRect().top;
        }
      }}
    >
      <div className="studio-home-inner">
        <header className="home-heading">
          <div>
            <h1 id="home-title">工作区</h1>
            <p>
              {recentItems.length > 0
                ? "接着上次的进度，或开始新的研究与创作。"
                : "从一个工作区开始，研究、阅读与创作。"}
            </p>
          </div>
          <span className="home-workspace-count">{LAUNCH_PAD_APPS.length} 个工作区</span>
        </header>

        {recentItems.length > 0 && (
          <section className="home-recent" aria-labelledby="home-recent-title">
            <h2 id="home-recent-title">
              <Clock3 aria-hidden="true" />
              最近使用
            </h2>
            <div className="home-recent-grid">
              {recentItems.map(({ entry, app, document }, index) => (
                <button
                  key={entry.appId}
                  type="button"
                  className="home-recent-link"
                  onClick={() => navigation.navigate(entry.href)}
                  aria-label={`继续 ${document.title}`}
                  title={`${document.title} · ${new Date(entry.visitedAt).toLocaleString()}`}
                  data-recent-app={entry.appId}
                >
                  <app.icon className="home-recent-icon" />
                  <span className="home-app-copy">
                    <span className="home-app-title">{document.title}</span>
                    <span className="home-app-description">{document.subtitle}</span>
                  </span>
                  <span className="home-recent-action">
                    {index === 0 ? "继续" : <ArrowRight aria-hidden="true" />}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        <div className="home-workspaces">
          {HOME_SECTIONS.filter((group) => group.apps.length > 0).map((group) => (
            <section className="home-section" key={group.id} aria-labelledby={`home-${group.id}`}>
              <h2 id={`home-${group.id}`}>{group.title}</h2>
              <div className="home-app-grid">{group.apps.map((app) => appLink(app))}</div>
            </section>
          ))}
        </div>

        <details className="home-more-tools">
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
