import { lazy, type ComponentType } from "react";
import { workspaceSearchPlugin } from "../assistant/workspace-search-plugin";
import type { AppManifest, PanelManifest } from "@bcr/shell-contract";
import { manifest as data } from "@bcr/data-studio/app-manifest";
import { manifest as documents } from "@bcr/document-studio/app-manifest";
import { manifest as reader } from "@bcr/reader-studio/app-manifest";
import { manifest as docgen } from "@bcr/docgen-studio/app-manifest";
import { manifest as manga } from "@bcr/manga-studio/app-manifest";
import { manifest as markets } from "@bcr/market-board/app-manifest";
import { manifest as media } from "@bcr/media-studio/app-manifest";
import { manifest as quant } from "@bcr/quant-lab/app-manifest";
import { ASSISTANT_PANEL, KNOWLEDGE_MANIFEST, STUDIO_MANIFEST } from "./host-manifests";

/**
 * The one list of applications the shell knows about.
 *
 * Each entry is a manifest the app itself owns: path, search parsing, launch
 * placement, palette naming and compute registration all come from one
 * declaration, so adding an app is one import here plus one file in that app —
 * not an edit to the router, the palette, the launch pad and the compute worker
 * in lockstep.
 *
 * Order matters: it is the launch-pad order, which `Alt+1..9` indexes.
 */
const declared: ReadonlyArray<AppManifest> = [
  STUDIO_MANIFEST,
  media,
  quant,
  markets,
  manga,
  documents,
  reader,
  data,
  docgen,
  KNOWLEDGE_MANIFEST,
];

export const PLUGINS = [workspaceSearchPlugin, ...declared.flatMap((app) => app.plugins ?? [])];

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

export type ActiveView = "home" | string;

/** Apps advertised on the launch pad, in `Alt+N` order. */
export type LaunchEntry = RegisteredApp | PanelManifest;
export const PANELS: readonly PanelManifest[] = [ASSISTANT_PANEL];
export const LAUNCH_PAD_APPS: ReadonlyArray<LaunchEntry> = [...MANIFESTS, ...PANELS].filter(
  (app) => app.section !== null,
);

/** Launch pad split by where the app belongs. */
export const COMPUTE_APPS = LAUNCH_PAD_APPS.filter((app) => app.section === "compute");
export const PERSONAL_APPS = LAUNCH_PAD_APPS.filter((app) => app.section === "personal");

export function appIdFromPath(pathname: string): ActiveView {
  const app = MANIFESTS.find((a) => pathname === a.path || pathname.startsWith(`${a.path}/`));
  return app?.id ?? "home";
}
