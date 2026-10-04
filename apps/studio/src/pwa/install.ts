import { pwaAtPath, pwaForApp, type PwaApp } from "./apps";

import { captureAppInstallPrompt, resetAppInstallPrompt } from "@bcr/react";

export function captureInstallPrompt() {
  captureAppInstallPrompt(() => pwaAtPath(location.pathname)?.manifestUrl);
}
export function syncInstallMetadata(app?: PwaApp) {
  const presentation = app ?? pwaForApp("workspace")!;
  document
    .querySelector('meta[name="application-name"]')
    ?.setAttribute("content", presentation.name);
  document
    .querySelector('link[rel="apple-touch-icon"]')
    ?.setAttribute("href", `/icons/${presentation.icon}-icon-192.png`);
  let link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (app && link?.getAttribute("href") === app.manifestUrl) return;
  resetAppInstallPrompt();
  if (!app) {
    link?.remove();
    return;
  }
  if (!link) {
    link = document.createElement("link");
    link.rel = "manifest";
    document.head.append(link);
  }
  link.href = app.manifestUrl;
}
