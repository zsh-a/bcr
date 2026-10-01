/**
 * Installation identities are stable and separate from the shell's component registry.
 *
 * 命名对照（与 shell/host-manifests.ts 的壳层清单互相指认）：两份清单是同一套
 * 应用的平行事实，path 对齐只靠取值巧合——Shell.tsx 拿壳层 manifest id 直接当
 * 本清单的 key 查安装身份（pwaForApp），首页路由 "/" 在壳层叫 "home"，靠下面
 * pwaForApp 里 home→workspace 的字面映射找回 key "workspace"。也就是说
 * workspace（本清单的 key）/ studio（壳层 STUDIO_MANIFEST 的 id、宿主包名
 * @bcr/studio）/ "/"（路由）是同一个宿主工作区的三个名字，改名即断。
 * key/id/scope/startUrl 是已发布的安装身份，取值必须逐字节不变：改了会让用户
 * 已安装的 PWA 失去身份、被当成新应用重复安装。
 */
export const PWA_APPS = [
  {
    // 宿主工作区首页的安装身份（见顶部命名对照）；key 不能改。
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
    key: "diagram",
    name: "BCR 绘图",
    shortName: "绘图",
    path: "/diagram",
    entry: "src/diagram/DiagramApp.tsx",
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
