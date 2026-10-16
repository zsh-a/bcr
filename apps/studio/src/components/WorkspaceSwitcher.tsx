import { ChevronRight } from "lucide-react";
import { Link } from "@tanstack/react-router";
import {
  HOME_SECTIONS,
  MORE_TOOL_SECTIONS,
  MANIFESTS,
  type RegisteredApp,
} from "../shell/registry";
import type { RecentWorkspace } from "../shell/recent-workspaces";

/** Direct routes keep app sessions mounted and restore recent document locations. */
export function WorkspaceSwitcher({
  active,
  recent,
  onSelect,
}: {
  active: string;
  recent: readonly RecentWorkspace[];
  onSelect: () => void;
}) {
  const recentApps = recent.filter((entry) => entry.appId !== active).slice(0, 3);
  const appLink = (app: RegisteredApp, href: string = app.path) => (
    <Link
      key={app.id}
      to={href}
      className="studio-switcher-app"
      aria-current={app.id === active ? "page" : undefined}
      onClick={onSelect}
    >
      <span aria-hidden="true">
        <app.icon className="size-5" />
      </span>
      <span>{app.displayTitle ?? app.title}</span>
      {app.id === active && <small>当前</small>}
    </Link>
  );
  return (
    <nav className="studio-switcher" aria-label="切换应用">
      {recentApps.length > 0 && (
        <section>
          <h2>最近使用</h2>
          <div className="studio-switcher-grid">
            {recentApps.map((entry) => {
              const app = MANIFESTS.find((item) => item.id === entry.appId);
              return app ? appLink(app, entry.href) : null;
            })}
          </div>
        </section>
      )}
      {HOME_SECTIONS.map((group) => (
        <section key={group.id}>
          <h2>{group.title}</h2>
          <div className="studio-switcher-grid">{group.apps.map((app) => appLink(app))}</div>
        </section>
      ))}
      <details className="studio-switcher-more">
        <summary>
          <ChevronRight size={14} aria-hidden="true" />
          更多工具
        </summary>
        <div className="studio-switcher-grid">
          {MORE_TOOL_SECTIONS.flatMap((group) => group.apps).map((app) => appLink(app))}
        </div>
      </details>
    </nav>
  );
}
