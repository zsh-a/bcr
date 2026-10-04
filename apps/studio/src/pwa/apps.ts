import { INSTALLABLE_APPS } from "../shell/app-definitions";
/** Published installation IDs remain stable; app identity and paths come from the domain catalog. */
export const PWA_APPS = INSTALLABLE_APPS.map((definition) => {
  const app = { key: definition.id, path: definition.path, ...definition.installation };

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
    ...(app.key === "reader" || app.key === "knowledge"
      ? {
          description:
            app.key === "reader"
              ? "离线阅读 EPUB、PDF 与 TXT，保存阅读进度和书签"
              : "随时记录想法、收藏链接，离线编辑与同步笔记",
          share_target: {
            action: `${app.scope}share`,
            method: "POST",
            enctype: "multipart/form-data",
            params: {
              title: "title",
              text: "text",
              url: "url",
              ...(app.key === "reader"
                ? {
                    files: [
                      {
                        name: "files",
                        accept: [
                          "application/epub+zip",
                          "application/pdf",
                          "text/plain",
                          ".epub",
                          ".pdf",
                          ".txt",
                        ],
                      },
                    ],
                  }
                : {}),
            },
          },
          shortcuts:
            app.key === "reader"
              ? [{ name: "打开书库", url: `${app.startUrl}?action=library` }]
              : [{ name: "新建笔记", url: `${app.startUrl}?action=new` }],
        }
      : {}),
    icons: [192, 512].map((size) => ({
      src: `/icons/${app.icon}-icon-${size}.png`,
      sizes: `${size}x${size}`,
      type: "image/png",
      purpose: "any maskable",
    })),
  };
}
