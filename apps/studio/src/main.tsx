import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "dockview-react/dist/styles/dockview.css";
import "./styles.css";

import { RouterProvider } from "@tanstack/react-router";
import { createRoot } from "react-dom/client";
import { router } from "./router";

type ReaderInstallWindow = Window & {
  __bcrReaderInstallPrompt?: Event;
};

function captureReaderInstallPrompt(): void {
  const viteEnv = (import.meta as ImportMeta & { readonly env?: { readonly PROD?: boolean } }).env;
  if (viteEnv?.PROD !== true) return;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    (window as ReaderInstallWindow).__bcrReaderInstallPrompt = event;
    window.dispatchEvent(new Event("bcr-reader-install-prompt"));
  });
  window.addEventListener("appinstalled", () => {
    delete (window as ReaderInstallWindow).__bcrReaderInstallPrompt;
  });
}

function registerReaderServiceWorker(): void {
  const viteEnv = (import.meta as ImportMeta & { readonly env?: { readonly PROD?: boolean } }).env;
  if (viteEnv?.PROD !== true || !("serviceWorker" in navigator)) return;
  const register = () => {
    void navigator.serviceWorker.register("/sw.js", { scope: "/" });
  };
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}

captureReaderInstallPrompt();
registerReaderServiceWorker();

// 不用 StrictMode：OffscreenCanvas 的 transferControlToOffscreen
// 每块 canvas 只能执行一次，double-effect 会破坏 render.worker 挂载。
const container = document.getElementById("root");
if (container === null) throw new Error("missing #root");

createRoot(container).render(<RouterProvider router={router} />);
