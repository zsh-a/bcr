import { describe, expect, it } from "vitest";
import { APP_DEFINITIONS } from "../src/shell/app-definitions";
import {
  readRecentWorkspaces,
  recentWorkspaceDocument,
  rememberWorkspace,
} from "../src/shell/recent-workspaces";

describe("recent workspace navigation", () => {
  it("recovers from corrupt storage and ignores foreign, mismatched and removed routes", () => {
    expect(readRecentWorkspaces("{broken", APP_DEFINITIONS)).toEqual([]);
    const saved = [
      { appId: "knowledge", href: "/knowledge?note=first", visitedAt: 5 },
      { appId: "reader", href: "//example.com/reader", visitedAt: 4 },
      { appId: "data", href: "/knowledge", visitedAt: 3 },
      { appId: "removed", href: "/removed", visitedAt: 2 },
      { appId: "studio", href: "/studio", visitedAt: "yesterday" },
      { appId: "studio", href: "//[", visitedAt: 1 },
    ];
    expect(readRecentWorkspaces(JSON.stringify(saved), APP_DEFINITIONS)).toEqual([saved[0]]);
  });

  it("retains the latest deep link per workspace and bounds history", () => {
    const recent = APP_DEFINITIONS.slice(0, 7).map((app, index) => ({
      appId: app.id,
      href: app.path,
      visitedAt: index + 1,
    }));
    const latest = {
      appId: "reader",
      href: "/reader?book=one&section=two#paragraph",
      visitedAt: 20,
    };
    const result = rememberWorkspace(recent, latest);
    expect(result).toHaveLength(5);
    expect(result[0]).toEqual(latest);
    expect(result.filter((item) => item.appId === "reader")).toHaveLength(1);
    expect(readRecentWorkspaces(JSON.stringify(result), APP_DEFINITIONS)[0]).toEqual(latest);
  });

  it("uses the indexed document title while preserving the exact visited route", () => {
    const app = APP_DEFINITIONS.find((item) => item.id === "reader")!;
    const entry = { appId: app.id, href: "/reader?book=one", visitedAt: 20 };
    const document = {
      id: "book:one",
      kind: "reader-book" as const,
      source: "reader",
      title: "正在读的书",
      route: entry.href,
      updatedAt: 10,
    };
    expect(recentWorkspaceDocument(entry, app, [document])).toMatchObject({
      title: "正在读的书",
      subtitle: "阅读器",
      route: entry.href,
    });
    expect(recentWorkspaceDocument(entry, app, [])).toMatchObject({
      title: "阅读器",
      route: entry.href,
    });
  });
});
