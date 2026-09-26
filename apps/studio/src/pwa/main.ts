import { pwaAtPath } from "./apps";
import { captureInstallPrompt } from "./install";
import { preparePwaAssets, registerPwaWorker } from "./register";
const app = pwaAtPath(location.pathname);
if (!app || app.key === "knowledge") throw new Error("Unknown PWA entry");
captureInstallPrompt();
registerPwaWorker(`/pwa/sw.js?app=${app.key}`, app.scope);
const container = document.getElementById("root");
if (!container) throw new Error("missing #root");
const mounted = preparePwaAssets().then(() =>
  app.key === "reader"
    ? import("../reader-main").then(({ mountReader }) => mountReader(container))
    : import("../studio-main").then(({ mountStudio }) => mountStudio(container)),
);
void mounted.catch((reason: unknown) => {
  const message = document.createElement("p");
  message.setAttribute("role", "alert");
  message.textContent = `${app.name} 启动失败：${reason instanceof Error ? reason.message : String(reason)}`;
  container.replaceChildren(message);
});
