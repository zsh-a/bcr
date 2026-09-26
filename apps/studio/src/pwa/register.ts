const UPDATE_READY_EVENT = "bcr-update-ready";
const APPLY_UPDATE_EVENT = "bcr-apply-update";
const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1_000;
const UPDATE_CHECK_THROTTLE_MS = 60 * 1_000;
type PwaWindow = Window & { __bcrUpdateReady?: boolean };

export function registerPwaWorker(script: string, scope: string): void {
  const viteEnv = (import.meta as ImportMeta & { readonly env?: { readonly PROD?: boolean } }).env;
  if (viteEnv?.PROD !== true || !("serviceWorker" in navigator)) return;
  // Registration is non-blocking and starts the install while the selected
  // application entry is loading, instead of waiting for the page load event.
  void navigator.serviceWorker
    .register(script, { scope, updateViaCache: "none" })
    .then((registration) => {
      const pwaWindow = window as PwaWindow;
      let announcedWorker: ServiceWorker | null = null;
      let updateRequested = false;
      let reloadStarted = false;
      let lastUpdateCheck = 0;

      const activateWaitingWorker = () => {
        const waiting = registration.waiting;
        if (waiting === null) {
          // Another open tab can activate the shared worker first. In that
          // case this page is already controlled by the new release and only
          // needs the user-approved reload.
          if (pwaWindow.__bcrUpdateReady === true && !reloadStarted) {
            reloadStarted = true;
            window.location.reload();
          }
          return;
        }
        pwaWindow.__bcrUpdateReady = false;
        waiting.postMessage({ type: "SKIP_WAITING" });
      };

      const announceUpdate = (worker: ServiceWorker) => {
        if (worker === announcedWorker) return;
        announcedWorker = worker;
        pwaWindow.__bcrUpdateReady = true;
        window.dispatchEvent(new Event(UPDATE_READY_EVENT));
        if (updateRequested) activateWaitingWorker();
      };

      const watchInstallingWorker = (worker: ServiceWorker) => {
        const handleState = () => {
          if (worker.state === "installed" && registration.active !== null) {
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
      if (registration.waiting !== null && registration.active !== null) {
        announceUpdate(registration.waiting);
      }

      window.addEventListener(APPLY_UPDATE_EVENT, () => {
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

/** Hashed worker URLs share an asset-only scope; document scopes stay disjoint. */
export async function preparePwaAssets(): Promise<void> {
  const viteEnv = (import.meta as ImportMeta & { readonly env?: { readonly PROD?: boolean } }).env;
  if (viteEnv?.PROD !== true || !("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.register("/assets/sw.js", {
    scope: "/assets/",
    updateViaCache: "none",
  });
  if (registration.active?.state === "activated") return;
  const worker = registration.installing ?? registration.waiting ?? registration.active;
  if (!worker) throw new Error("离线资源服务未能启动，请刷新重试。");
  await new Promise<void>((resolve, reject) => {
    const changed = () => {
      if (worker.state !== "activated" && worker.state !== "redundant") return;
      worker.removeEventListener("statechange", changed);
      if (worker.state === "activated") resolve();
      else reject(new Error("离线资源服务安装失败，请联网重试。"));
    };
    worker.addEventListener("statechange", changed);
    changed();
  });
}
