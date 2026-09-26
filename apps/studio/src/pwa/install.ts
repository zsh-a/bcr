import { pwaAtPath, pwaForApp, type PwaApp } from "./apps";

interface InstallPrompt extends Event {
  prompt(): Promise<{ outcome: "accepted" | "dismissed" }>;
}
let prompt: InstallPrompt | null = null;
let captured = false;
const listeners = new Set<() => void>();
const publish = () => {
  for (const listener of listeners) listener();
};
export const installPrompt = {
  subscribe(this: void, listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot: () => prompt,
  async request() {
    const event = prompt;
    prompt = null;
    publish();
    await event?.prompt();
  },
};
export function captureInstallPrompt() {
  if (captured) return;
  captured = true;
  window.addEventListener("beforeinstallprompt", (event) => {
    // Only the dedicated install document consumes the native prompt. The
    // browser may still promote a correctly identified embedded document.
    const app = pwaAtPath(location.pathname);
    if (!app && location.pathname !== "/reader") return;
    event.preventDefault();
    prompt = event as InstallPrompt;
    if (app?.key === "reader" || location.pathname === "/reader") {
      (window as Window & { __bcrReaderInstallPrompt?: Event }).__bcrReaderInstallPrompt = event;
      window.dispatchEvent(new Event("bcr-reader-install-prompt"));
    }
    publish();
  });
  window.addEventListener("appinstalled", () => {
    prompt = null;
    delete (window as Window & { __bcrReaderInstallPrompt?: Event }).__bcrReaderInstallPrompt;
    publish();
  });
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
  prompt = null;
  delete (window as Window & { __bcrReaderInstallPrompt?: Event }).__bcrReaderInstallPrompt;
  publish();
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
