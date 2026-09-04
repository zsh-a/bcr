const READER_UPDATE_READY_EVENT = "bcr-reader-update-ready";
const READER_APPLY_UPDATE_EVENT = "bcr-reader-apply-update";
const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1_000;
const UPDATE_CHECK_THROTTLE_MS = 60 * 1_000;

type ReaderPwaWindow = Window & {
  __bcrReaderInstallPrompt?: Event;
  __bcrReaderUpdateReady?: boolean;
};

function captureReaderInstallPrompt(): void {
  const viteEnv = (import.meta as ImportMeta & { readonly env?: { readonly PROD?: boolean } }).env;
  if (viteEnv?.PROD !== true) return;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    (window as ReaderPwaWindow).__bcrReaderInstallPrompt = event;
    window.dispatchEvent(new Event("bcr-reader-install-prompt"));
  });
  window.addEventListener("appinstalled", () => {
    delete (window as ReaderPwaWindow).__bcrReaderInstallPrompt;
  });
}

function registerReaderServiceWorker(): void {
  const viteEnv = (import.meta as ImportMeta & { readonly env?: { readonly PROD?: boolean } }).env;
  if (viteEnv?.PROD !== true || !("serviceWorker" in navigator)) return;
  // Registration is non-blocking and starts the install while the selected
  // application entry is loading, instead of waiting for the page load event.
  void navigator.serviceWorker
    .register("/sw.js", { scope: "/", updateViaCache: "none" })
    .then((registration) => {
      const pwaWindow = window as ReaderPwaWindow;
      let announcedWorker: ServiceWorker | null = null;
      let updateRequested = false;
      let reloadStarted = false;
      let lastUpdateCheck = 0;

      const activateWaitingWorker = () => {
        const waiting = registration.waiting;
        if (waiting === null) {
          // Another open Reader can activate the shared worker first. In that
          // case this page is already controlled by the new release and only
          // needs the user-approved reload.
          if (pwaWindow.__bcrReaderUpdateReady === true && !reloadStarted) {
            reloadStarted = true;
            window.location.reload();
          }
          return;
        }
        pwaWindow.__bcrReaderUpdateReady = false;
        waiting.postMessage({ type: "SKIP_WAITING" });
      };

      const announceUpdate = (worker: ServiceWorker) => {
        if (worker === announcedWorker) return;
        announcedWorker = worker;
        pwaWindow.__bcrReaderUpdateReady = true;
        window.dispatchEvent(new Event(READER_UPDATE_READY_EVENT));
        if (updateRequested) activateWaitingWorker();
      };

      const watchInstallingWorker = (worker: ServiceWorker) => {
        const handleState = () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller !== null) {
            announceUpdate(worker);
          }
        };
        worker.addEventListener("statechange", handleState);
        handleState();
      };

      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        if (worker !== null) watchInstallingWorker(worker);
      });
      if (registration.installing !== null) watchInstallingWorker(registration.installing);
      if (registration.waiting !== null && navigator.serviceWorker.controller !== null) {
        announceUpdate(registration.waiting);
      }

      window.addEventListener(READER_APPLY_UPDATE_EVENT, () => {
        updateRequested = true;
        activateWaitingWorker();
      });

      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (!updateRequested || reloadStarted) return;
        reloadStarted = true;
        window.location.reload();
      });

      const checkForUpdate = (force = false) => {
        if (document.visibilityState !== "visible" || navigator.onLine === false) return;
        const now = Date.now();
        if (!force && now - lastUpdateCheck < UPDATE_CHECK_THROTTLE_MS) return;
        lastUpdateCheck = now;
        void registration.update().catch(() => undefined);
      };
      window.addEventListener("online", () => checkForUpdate(true));
      document.addEventListener("visibilitychange", () => checkForUpdate());
      window.setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);
      if (registration.installing === null && registration.waiting === null) {
        checkForUpdate(true);
      }
    })
    .catch(() => undefined);
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
