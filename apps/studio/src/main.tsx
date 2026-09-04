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
  // Registration is non-blocking and starts the install while the selected
  // application entry is loading, instead of waiting for the page load event.
  void navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

captureReaderInstallPrompt();
registerReaderServiceWorker();

const rootElement = document.getElementById("root");
if (rootElement === null) throw new Error("missing #root");
const container: HTMLElement = rootElement;

function isStandaloneReader(): boolean {
  if (window.location.pathname !== "/reader" && !window.location.pathname.startsWith("/reader/")) {
    return false;
  }
  const standaloneMedia =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(display-mode: standalone)").matches;
  const iosStandalone = Boolean(
    (navigator as Navigator & { readonly standalone?: boolean }).standalone,
  );
  return standaloneMedia || iosStandalone;
}

function showBootstrapError(reason: unknown): void {
  const message = reason instanceof Error ? reason.message : String(reason);
  container.replaceChildren();
  const error = document.createElement("p");
  error.className = "bcr-bootstrap-error";
  error.textContent = `BCR 启动失败：${message}`;
  container.append(error);
}

// The installed Reader is a focused PWA surface. Keep the Studio shell out of
// its initial module graph; desktop/browser Reader routes still use the full
// Shell so shared search and cross-workspace handoffs remain available there.
const entry = isStandaloneReader()
  ? import("./reader-main").then(({ mountReader }) => mountReader(container))
  : import("./studio-main").then(({ mountStudio }) => mountStudio(container));

void entry.catch(showBootstrapError);
