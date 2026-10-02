import { APP_DEFINITIONS } from "./app-definitions";
import { lazy, type ComponentType } from "react";
import { workspaceSearchPlugin } from "../assistant/workspace-search-plugin";
import type { AppManifest, AppSection, PanelManifest } from "@bcr/shell-contract";
import { manifest as data } from "@bcr/data-studio/app-manifest";
import { manifest as documents } from "@bcr/document-studio/app-manifest";
import { manifest as reader } from "@bcr/reader-studio/app-manifest";
import { manifest as docgen } from "@bcr/docgen-studio/app-manifest";
import { manifest as manga } from "@bcr/manga-studio/app-manifest";
import { manifest as markets } from "@bcr/market-board/app-manifest";
import { manifest as media } from "@bcr/media-studio/app-manifest";
import { manifest as quant } from "@bcr/quant-lab/app-manifest";
import {
  ASSISTANT_PANEL,
  KNOWLEDGE_MANIFEST,
  STUDIO_MANIFEST,
  DIAGRAM_MANIFEST,
} from "./host-manifests";

/**
 * The one list of applications the shell knows about.
 *
 * Each entry is a manifest the app itself owns: path, search parsing, launch
 * placement, palette naming and compute registration all come from one
 * declaration, so adding an app is one import here plus one file in that app —
 * not an edit to the router, the palette, the launch pad and the compute worker
 * in lockstep.
 *
 * Within each section, declaration order determines the launch order. Routing,
 * plugins and compute contributions include every app, regardless of placement.
 */
const implementations = {
  markets,
  quant,
  reader,
  knowledge: KNOWLEDGE_MANIFEST,
  diagram: DIAGRAM_MANIFEST,
  media,
  data,
  manga,
  documents,
  studio: STUDIO_MANIFEST,
  docgen,
} satisfies Record<(typeof APP_DEFINITIONS)[number]["id"], AppManifest>;

const declared: ReadonlyArray<AppManifest> = APP_DEFINITIONS.map((definition) => {
  return implementations[definition.id];
});

export const PLUGINS = [workspaceSearchPlugin, ...declared.flatMap((app) => app.plugins ?? [])];
export const AGENT_RENDERERS = PLUGINS.flatMap((plugin) => plugin.agentRenderers ?? []);

export interface RegisteredApp extends AppManifest {
  readonly kind: "workspace";
  readonly component: ComponentType;
}

/** Manifests with their entry loaders resolved into renderable components. */
export const MANIFESTS: ReadonlyArray<RegisteredApp> = declared.map((app) => ({
  ...app,
  kind: "workspace",
  component: lazy(() => app.load().then((m) => ({ default: m.App }))),
}));

export type ActiveView = string;

export const PANELS: readonly PanelManifest[] = [ASSISTANT_PANEL];

interface WorkspaceSection {
  readonly id: Exclude<AppSection, null>;
  readonly title: string;
  readonly apps: readonly RegisteredApp[];
}

function section(id: WorkspaceSection["id"], title: string): WorkspaceSection {
  return { id, title, apps: MANIFESTS.filter((app) => app.section === id) };
}

/** Product navigation, expressed as tasks rather than runtime capabilities. */
export const HOME_SECTIONS = [
  section("research", "市场与策略"),
  section("reading", "阅读与知识"),
  section("tools", "数据与媒体"),
];
export const MORE_TOOL_SECTIONS = [
  section("experimental", "实验工具"),
  section("developer", "开发工具"),
];

/** Only primary workspaces receive Alt+N; panels retain their own shortcuts. */
export const LAUNCH_PAD_APPS = HOME_SECTIONS.flatMap((group) => group.apps);

export function launchShortcut(id: string): string | undefined {
  const index = LAUNCH_PAD_APPS.findIndex((app) => app.id === id);
  return index >= 0 && index < 9 ? `Alt+${index + 1}` : undefined;
}

export function appIdFromPath(pathname: string): ActiveView {
  const app = MANIFESTS.find((a) => pathname === a.path || pathname.startsWith(`${a.path}/`));
  return app?.id ?? "home";
}
