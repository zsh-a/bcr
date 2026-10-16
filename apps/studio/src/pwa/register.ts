import { setAppOfflineState } from "@bcr/react";
import { startPwaUpdates } from "./updates";
let shellReady = false;
let assetsReady = false;
let retryOffline: (() => void) | undefined;
const publishOfflineReady = () => {
  if (shellReady && assetsReady) setAppOfflineState({ phase: "ready" });
};
if (typeof window !== "undefined")
  window.addEventListener("bcr-retry-offline", () => retryOffline?.());

export function registerPwaWorker(script: string, scope: string): void {
  const viteEnv = (import.meta as ImportMeta & { readonly env?: { readonly PROD?: boolean } }).env;
  if (viteEnv?.PROD !== true || !("serviceWorker" in navigator)) return;
  const dedicated = scope !== "/";
  const fail = (reason: unknown) => {
    if (dedicated && !shellReady)
      setAppOfflineState({
        phase: "error",
        message: reason instanceof Error ? reason.message : "请联网后重试。",
      });
  };
  if (dedicated && !shellReady) setAppOfflineState({ phase: "preparing" });
  const retry = startPwaUpdates(
    script,
    scope,
    (registration) => {
      const watchOffline = () => {
        if (!dedicated) return;
        const worker = registration.installing ?? registration.active;
        const changed = () => {
          if (registration.active?.state === "activated") {
            shellReady = true;
            publishOfflineReady();
          } else if (worker?.state === "redundant")
            fail(new Error("离线下载未完成，请检查网络后重试。"));
        };
        worker?.addEventListener("statechange", changed);
        changed();
      };
      registration.addEventListener("updatefound", watchOffline);
      watchOffline();
    },
    fail,
  );
  if (dedicated) retryOffline = retry;
}

/** Hashed worker URLs share an asset-only scope; document scopes stay disjoint. */
export async function preparePwaAssets(): Promise<void> {
  const viteEnv = (import.meta as ImportMeta & { readonly env?: { readonly PROD?: boolean } }).env;
  if (viteEnv?.PROD !== true || !("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.register("/assets/sw.js", {
    scope: "/assets/",
    updateViaCache: "none",
  });
  if (registration.active?.state === "activated") {
    assetsReady = true;
    publishOfflineReady();
    return;
  }
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
  assetsReady = true;
  publishOfflineReady();
}
