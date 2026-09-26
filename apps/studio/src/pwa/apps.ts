/** Installation identities are stable and separate from the shell's component registry. */
export const PWA_APPS = [
  {
    key: "workspace",
    name: "BCR Workspace",
    shortName: "工作区",
    path: "/",
    entry: "src/studio-main.tsx",
  },
  {
    key: "studio",
    name: "BCR Studio",
    shortName: "计算工作台",
    path: "/studio",
    entry: "src/studio-main.tsx",
  },
  {
    key: "reader",
    name: "BCR Reader",
    shortName: "Reader",
    path: "/reader",
    entry: "src/reader-main.tsx",
  },
  {
    key: "knowledge",
    name: "BCR 笔记",
    shortName: "笔记",
    path: "/knowledge",
    entry: "notes/knowledge/index.html",
  },
  {
    key: "markets",
    name: "BCR Market Atlas",
    shortName: "市场",
    path: "/markets",
    entry: "../market-board/src/App.tsx",
  },
  {
    key: "media",
    name: "BCR Media Studio",
    shortName: "媒体",
    path: "/media",
    entry: "../media-studio/src/App.tsx",
  },
  {
    key: "quant",
    name: "BCR Quant Lab",
    shortName: "量化",
    path: "/quant",
    entry: "../quant-lab/src/App.tsx",
  },
  {
    key: "manga",
    name: "BCR Manga Studio",
    shortName: "漫画",
    path: "/manga",
    entry: "../manga-studio/src/App.tsx",
  },
  {
    key: "documents",
    name: "BCR Document Studio",
    shortName: "文档",
    path: "/documents",
    entry: "../../packages/document-studio/src/App.tsx",
  },
  {
    key: "data",
    name: "BCR Data Studio",
    shortName: "数据",
    path: "/data",
    entry: "../../packages/data-studio/src/App.tsx",
  },
  {
    key: "docgen",
    name: "BCR DocGen Lab",
    shortName: "文档生成",
    path: "/docgen",
    entry: "../docgen-studio/src/App.tsx",
  },
].map((app) => {
  const scope = app.key === "knowledge" ? "/notes/" : `/pwa/${app.key}/`;
  return {
    ...app,
    // Keep both previously published identities, including Reader's lack of trailing slash.
    id: app.key === "reader" ? "/reader" : app.key === "knowledge" ? "/notes/" : scope,
    scope,
    startUrl: app.key === "knowledge" ? "/notes/knowledge/" : scope,
    manifestUrl: app.key === "reader" ? "/manifest.webmanifest" : `${scope}manifest.webmanifest`,
    icon: app.key === "knowledge" ? "knowledge" : app.key,
  };
});
export type PwaApp = (typeof PWA_APPS)[number];
export function pwaAtPath(pathname: string): PwaApp | undefined {
  return PWA_APPS.find(
    (app) => pathname === app.scope.slice(0, -1) || pathname.startsWith(app.scope),
  );
}
export function pwaForApp(key: string): PwaApp | undefined {
  return PWA_APPS.find((app) => app.key === (key === "home" ? "workspace" : key));
}
export function webManifest(app: PwaApp) {
  return {
    id: app.id,
    name: app.name,
    short_name: app.shortName,
    lang: "zh-CN",
    start_url: app.startUrl,
    scope: app.scope,
    display: "standalone",
    orientation: "any",
    background_color: "#151619",
    theme_color: "#147a73",
    icons: [192, 512].map((size) => ({
      src: `/icons/${app.icon}-icon-${size}.png`,
      sizes: `${size}x${size}`,
      type: "image/png",
      purpose: "any maskable",
    })),
  };
}
