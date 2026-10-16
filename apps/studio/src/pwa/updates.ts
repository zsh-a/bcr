import { configureAppUpdates, setAppUpdateState } from "@bcr/react";

const CHECK_INTERVAL_MS = 5 * 60 * 1_000;
const CHECK_THROTTLE_MS = 60 * 1_000;
const INSTALL_TIMEOUT_MS = 45_000;

function installed(worker: ServiceWorker): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      worker.removeEventListener("statechange", changed);
      if (error) reject(error);
      else resolve();
    };
    const changed = () => {
      if (["installed", "activating", "activated"].includes(worker.state)) finish();
      else if (worker.state === "redundant")
        finish(new Error("新版资源下载失败，请检查网络后重试。"));
    };
    const timeout = setTimeout(
      () => finish(new Error("新版资源下载超时，请重试检查更新。")),
      INSTALL_TIMEOUT_MS,
    );
    worker.addEventListener("statechange", changed);
    changed();
  });
}

/** One update owner per document; retries also recover a failed first registration. */
export function startPwaUpdates(
  script: string,
  scope: string,
  onRegistration: (registration: ServiceWorkerRegistration) => void,
  onError: (reason: unknown) => void,
): () => void {
  let registration: ServiceWorkerRegistration | undefined;
  let pending: Promise<void> | undefined;
  let foreground = false;
  let recovering = false;
  let reloadPhase: "ready" | "reload" | undefined;
  let updateRequested = false;
  let reloadStarted = false;
  let lastCheck = 0;
  let announcedWorker: ServiceWorker | undefined;
  const watched = new WeakSet<ServiceWorker>();

  const reload = () => {
    if (reloadStarted) return;
    reloadStarted = true;
    window.location.reload();
  };
  const ready = (worker: ServiceWorker) => {
    reloadPhase = "ready";
    if (announcedWorker === worker && !foreground) return;
    announcedWorker = worker;
    setAppUpdateState({ phase: "ready", checkedAt: Date.now() });
  };
  const watch = (worker: ServiceWorker) => {
    if (watched.has(worker)) return;
    watched.add(worker);
    if (registration?.active && worker.state === "installing")
      setAppUpdateState({ phase: "checking" });
    const changed = () => {
      if (worker.state === "installed") {
        if (registration?.active) ready(worker);
      } else if (worker.state === "redundant") {
        if (registration?.active || foreground || recovering)
          setAppUpdateState({ phase: "error", message: "新版资源下载失败，请检查网络后重试。" });
      } else return;
      worker.removeEventListener("statechange", changed);
    };
    worker.addEventListener("statechange", changed);
    changed();
  };
  const check = (show = false, force = false) => {
    foreground ||= show;
    if (show) setAppUpdateState({ phase: "checking" });
    if (pending) return;
    if (navigator.onLine === false) {
      if (foreground || recovering)
        setAppUpdateState({ phase: "error", message: "当前离线，请联网后重试检查更新。" });
      foreground = false;
      return;
    }
    if (
      !force &&
      (document.visibilityState !== "visible" || Date.now() - lastCheck < CHECK_THROTTLE_MS)
    )
      return;
    lastCheck = Date.now();
    pending = (async () => {
      if (
        !registration ||
        (!registration.active && !registration.installing && !registration.waiting)
      ) {
        registration = await navigator.serviceWorker.register(script, {
          scope,
          updateViaCache: "none",
          type: scope === "/" ? "classic" : "module",
        });
        onRegistration(registration);
        registration.addEventListener("updatefound", () => {
          if (registration?.installing) watch(registration.installing);
        });
      } else if (!registration.installing && !registration.waiting) {
        await registration.update();
      }
      if (registration.installing) {
        const worker = registration.installing;
        watch(worker);
        await installed(worker);
      }
      if (registration.waiting && registration.active) ready(registration.waiting);
      else if (reloadPhase) {
        if (foreground) setAppUpdateState({ phase: reloadPhase, checkedAt: Date.now() });
      } else if (recovering) {
        // No newer worker exists (or this is the first installation). A user-approved
        // reload can retry the failed module without losing pending domain saves.
        reloadPhase = "reload";
        setAppUpdateState({ phase: "reload", checkedAt: Date.now() });
      } else setAppUpdateState({ phase: foreground ? "current" : "idle", checkedAt: Date.now() });
    })()
      .catch((reason: unknown) => {
        onError(reason);
        if (foreground || recovering || registration?.active)
          setAppUpdateState({
            phase: "error",
            message: "暂时无法完成更新检查，请检查网络后重试。",
            ...(reason instanceof Error ? { details: reason.message } : {}),
          });
      })
      .finally(() => {
        pending = undefined;
        foreground = false;
      });
  };
  configureAppUpdates({
    buildId: __BCR_APP_VERSION__,
    check: () => check(true, true),
    apply: () => {
      const waiting = registration?.waiting;
      if (!waiting && !reloadPhase) throw new Error("更新尚未准备好，请先检查更新。");
      updateRequested = true;
      if (waiting) waiting.postMessage({ type: "SKIP_WAITING" });
      else reload();
    },
  });
  window.addEventListener("vite:preloadError", () => {
    recovering = true;
    check(true, true);
  });
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (updateRequested) reload();
  });
  window.addEventListener("online", () => check(recovering, true));
  window.addEventListener("focus", () => check());
  document.addEventListener("visibilitychange", () => check());
  window.setInterval(() => check(), CHECK_INTERVAL_MS);
  check(false, true);
  return () => check(true, true);
}
