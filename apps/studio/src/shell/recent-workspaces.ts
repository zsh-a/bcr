import type { SearchDocument } from "@bcr/core";
import type { AppDefinition } from "@bcr/shell-contract";

export const RECENT_WORKSPACES_KEY = "bcr:recent-workspaces:v1";

export interface RecentWorkspace {
  readonly appId: string;
  readonly href: string;
  readonly visitedAt: number;
}

/** Only canonical, registered local routes may be restored from browser storage. */
export function readRecentWorkspaces(
  raw: string | null,
  apps: readonly AppDefinition[],
): readonly RecentWorkspace[] {
  try {
    const values: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(values)) return [];
    const seen = new Set<string>();
    return values
      .filter((value): value is RecentWorkspace => {
        if (!value || typeof value !== "object") return false;
        const { appId, href, visitedAt } = value;
        const app = apps.find((item) => item.id === appId);
        if (!app || typeof href !== "string" || !Number.isFinite(visitedAt) || visitedAt <= 0)
          return false;
        let url: URL;
        try {
          url = new URL(href, "https://workspace.invalid");
        } catch {
          return false;
        }
        if (
          !href.startsWith("/") ||
          url.origin !== "https://workspace.invalid" ||
          (url.pathname !== app.path && !url.pathname.startsWith(`${app.path}/`)) ||
          seen.has(appId)
        )
          return false;
        seen.add(appId);
        return true;
      })
      .sort((a, b) => b.visitedAt - a.visitedAt)
      .slice(0, 5);
  } catch {
    return [];
  }
}

export function rememberWorkspace(
  previous: readonly RecentWorkspace[],
  entry: RecentWorkspace,
): readonly RecentWorkspace[] {
  return [entry, ...previous.filter((item) => item.appId !== entry.appId)].slice(0, 5);
}

export function recentWorkspaceDocument(
  entry: RecentWorkspace,
  app: AppDefinition,
  documents: readonly SearchDocument[],
): SearchDocument {
  const document = documents.find((item) => item.kind !== "app" && item.route === entry.href);
  return {
    id: `recent:${entry.appId}`,
    source: "workspace",
    kind: "app",
    title: document?.title ?? app.displayTitle ?? app.title,
    subtitle: document ? (app.displayTitle ?? app.title) : "返回上次访问的位置",
    route: entry.href,
    updatedAt: entry.visitedAt,
  };
}
