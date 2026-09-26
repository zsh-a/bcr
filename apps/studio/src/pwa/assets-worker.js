// Worker scripts live under /assets/, outside every app's document scope.
// This non-application scope lets their nested imports/wasm use the same
// immutable assets already staged by each app, without a catch-all root SW.
const CACHE = "bcr-worker-assets-v1";
globalThis.addEventListener("install", (event) => event.waitUntil(globalThis.skipWaiting()));
globalThis.addEventListener("activate", (event) => event.waitUntil(globalThis.clients.claim()));
globalThis.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  const localAsset = url.origin === location.origin && url.pathname.startsWith("/assets/");
  // Cloudflare excludes these >25 MiB modules from static assets. Cache only
  // the pinned, CORS-readable engine URLs already used by Quant Lab.
  const columnarEngine =
    url.origin === "https://cdn.jsdelivr.net" &&
    /^\/npm\/@duckdb\/duckdb-wasm@1\.32\.0\/dist\/duckdb-(eh|mvp)\.wasm$/u.test(url.pathname);
  if (request.method !== "GET" || (!localAsset && !columnarEngine) || request.mode === "navigate")
    return;
  event.respondWith(
    (async () => {
      const names = (await caches.keys()).filter(
        (name) =>
          name === CACHE ||
          name.startsWith("bcr-pwa-") ||
          name.startsWith("bcr-reader-shell-") ||
          name.startsWith("bcr-knowledge-shell-"),
      );
      for (const name of names) {
        const cached = await (await caches.open(name)).match(request);
        if (cached) return cached;
      }
      const response = await fetch(request);
      if (response.ok)
        await (await caches.open(CACHE)).put(request, response.clone()).catch(() => undefined);
      return response;
    })(),
  );
});
