const CACHE_NAME = "bcr-reader-shell-v3";
const BUILD_MANIFEST = "/build-manifest.json";
const NETWORK_TIMEOUT_MS = 2_000;
const APP_SHELL = [
  "/",
  "/reader",
  "/manifest.webmanifest",
  "/icons/reader-icon-192.svg",
  "/icons/reader-icon-512.svg",
];

function isRequiredReaderAsset(url) {
  // These are loaded only by metadata warmup or PDF reading. Leaving them to
  // the runtime cache keeps PWA installation and first launch lightweight.
  return !/pdf\.worker|sqlite3(?:-opfs-async-proxy)?|\.wasm$/u.test(url);
}

function addAsset(urls, value) {
  if (typeof value !== "string") return;
  const normalized = `/assets/${value.replace(/^\/?assets\//, "")}`;
  if (isRequiredReaderAsset(normalized)) urls.add(normalized);
}

function addManifestEntry(manifest, key, urls, visited) {
  if (visited.has(key)) return;
  visited.add(key);
  const entry = manifest[key];
  if (entry === undefined || typeof entry !== "object" || entry === null) return;

  for (const field of ["file", "css", "assets"]) {
    const value = entry[field];
    addAsset(urls, value);
    if (Array.isArray(value)) {
      for (const asset of value) addAsset(urls, asset);
    }
  }
  const imports = entry.imports;
  if (!Array.isArray(imports)) return;
  for (const dependency of imports) {
    if (typeof dependency === "string") addManifestEntry(manifest, dependency, urls, visited);
  }
}

async function shellUrls() {
  const urls = new Set(APP_SHELL);
  urls.add(BUILD_MANIFEST);
  if (self.navigator?.onLine === false) return [...urls];
  try {
    const response = await fetchWithTimeout(BUILD_MANIFEST, { cache: "no-store" });
    if (!response.ok) return [...urls];
    const manifest = await response.json();
    const visited = new Set();
    // The lightweight bootstrap chooses one of these graphs at runtime. Only
    // precache the Reader graph here; other Studio apps remain on demand.
    addManifestEntry(manifest, "index.html", urls, visited);
    addManifestEntry(manifest, "src/reader-main.tsx", urls, visited);
  } catch {
    // The static shell still gives offline navigation a usable fallback.
  }
  return [...urls];
}

async function fetchWithTimeout(request, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
  try {
    return await fetch(request, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function refreshAllowed() {
  return self.navigator?.onLine !== false;
}

async function cacheUrls(cache, urls) {
  await Promise.all(
    urls.map(async (url) => {
      try {
        await cache.add(url);
      } catch {
        // A missing optional chunk must not prevent the service worker from
        // activating; the runtime fetch handler can fill it later.
      }
    }),
  );
}

async function cacheNavigationResponse(request, response) {
  if (!response.ok) return response;
  const url = new URL(request.url);
  const cacheRequest = new Request(url.pathname, { method: "GET" });
  const copy = response.clone();
  void caches.open(CACHE_NAME).then((cache) => cache.put(cacheRequest, copy));
  return response;
}

function matchCached(request, pathname) {
  return caches
    .match(request, { ignoreVary: true })
    .then(
      (cached) =>
        cached ?? caches.match(new Request(pathname), { ignoreSearch: true, ignoreVary: true }),
    );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(async (cache) => cacheUrls(cache, await shellUrls()))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("bcr-reader-shell-") && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cached = await matchCached(request, url.pathname);
        const refresh = refreshAllowed()
          ? fetchWithTimeout(request)
              .then((response) => cacheNavigationResponse(request, response))
              .catch(() => undefined)
          : Promise.resolve(undefined);
        if (cached !== undefined) {
          // Return the cached document immediately and refresh it in the
          // background. This is the critical path for an installed PWA.
          event.waitUntil(refresh);
          return cached;
        }
        return (await refresh) ?? (await caches.match("/reader")) ?? (await caches.match("/"));
      })(),
    );
    return;
  }

  event.respondWith(
    matchCached(request, url.pathname).then((cached) => {
      if (cached !== undefined && !refreshAllowed()) return cached;
      const network = fetchWithTimeout(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached ?? Response.error());
      return cached ?? network;
    }),
  );
});
