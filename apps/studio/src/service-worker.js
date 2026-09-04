const BUILD_ID = globalThis.__BCR_READER_BUILD_ID__;
const CACHE_PREFIX = "bcr-reader-shell-";
const CACHE_NAME = `${CACHE_PREFIX}${BUILD_ID}`;
const BUILD_MANIFEST = "/build-manifest.json";
const NETWORK_TIMEOUT_MS = 2_000;
const INSTALL_TIMEOUT_MS = 12_000;
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

async function fetchWithTimeout(request, init = {}, timeoutMs = NETWORK_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(request, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function shellUrls() {
  const response = await fetchWithTimeout(
    BUILD_MANIFEST,
    { cache: "no-store" },
    INSTALL_TIMEOUT_MS,
  );
  if (!response.ok) throw new Error(`Reader build manifest returned ${response.status}`);

  const manifest = await response.json();
  const urls = new Set(APP_SHELL);
  urls.add(BUILD_MANIFEST);
  const visited = new Set();
  // The lightweight bootstrap chooses one of these graphs at runtime. Only
  // precache the Reader graph here; other Studio apps remain on demand.
  addManifestEntry(manifest, "index.html", urls, visited);
  addManifestEntry(manifest, "src/reader-main.tsx", urls, visited);
  return [...urls];
}

async function stageShell() {
  // A failed deployment or a transient network error must never expose a
  // partially populated cache as the next application version.
  await caches.delete(CACHE_NAME);
  const cache = await caches.open(CACHE_NAME);
  try {
    const urls = await shellUrls();
    await Promise.all(
      urls.map(async (url) => {
        const response = await fetchWithTimeout(url, { cache: "reload" }, INSTALL_TIMEOUT_MS);
        if (!response.ok) throw new Error(`Reader shell asset returned ${response.status}: ${url}`);
        await cache.put(new Request(url), response);
      }),
    );
  } catch (reason) {
    await caches.delete(CACHE_NAME);
    throw reason;
  }
}

function refreshAllowed() {
  return globalThis.navigator?.onLine !== false;
}

async function readerCacheNames() {
  const keys = await caches.keys();
  return keys.filter((key) => key.startsWith(CACHE_PREFIX));
}

async function matchCached(request, pathname) {
  const current = await caches.open(CACHE_NAME);
  const pathRequest = new Request(pathname);
  const currentMatch =
    (await current.match(request, { ignoreVary: true })) ??
    (await current.match(pathRequest, { ignoreSearch: true, ignoreVary: true }));
  if (currentMatch !== undefined) return currentMatch;

  // Keep old, already-open tabs functional after activation. Their lazy
  // imports may still refer to the immediately preceding hashed chunk graph.
  const fallbackNames = (await readerCacheNames())
    .filter((name) => name !== CACHE_NAME)
    .sort()
    .reverse();
  for (const name of fallbackNames) {
    const cache = await caches.open(name);
    const cached =
      (await cache.match(request, { ignoreVary: true })) ??
      (await cache.match(pathRequest, { ignoreSearch: true, ignoreVary: true }));
    if (cached !== undefined) return cached;
  }
  return undefined;
}

globalThis.addEventListener("install", (event) => {
  // Do not skip waiting here. Reader asks the user before replacing a running
  // release, then saves the current reading snapshot before sending the signal.
  event.waitUntil(stageShell());
});

globalThis.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") event.waitUntil(globalThis.skipWaiting());
});

globalThis.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const candidates = (await readerCacheNames()).filter((name) => name !== CACHE_NAME);
      const generatedCandidates = candidates
        .filter((name) => /^\d+$/u.test(name.slice(CACHE_PREFIX.length)))
        .sort()
        .reverse();
      // During the first migration the old cache is named "v3". Retain it
      // once, then prefer the immediately preceding timestamped release.
      const previous = generatedCandidates.slice(0, 1);
      if (previous.length === 0 && candidates[0] !== undefined) previous.push(candidates[0]);
      const retained = new Set([CACHE_NAME, ...previous]);
      await Promise.all(
        (await readerCacheNames())
          .filter((name) => !retained.has(name))
          .map((name) => caches.delete(name)),
      );
      await globalThis.clients.claim();
    })(),
  );
});

globalThis.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== globalThis.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cached = await matchCached(request, url.pathname);
        if (cached !== undefined) return cached;
        const shellPath = url.pathname.startsWith("/reader") ? "/reader" : "/";
        const shell = await matchCached(new Request(shellPath), shellPath);
        if (shell !== undefined) return shell;
        if (!refreshAllowed()) return Response.error();
        // Navigation documents are an atomic part of the versioned shell.
        // Never write a newly deployed index into an older active cache; the
        // installing worker will stage it together with its matching chunks.
        return fetchWithTimeout(request).catch(() => Response.error());
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await matchCached(request, url.pathname);
      if (cached !== undefined && !refreshAllowed()) return cached;
      const network = fetchWithTimeout(request)
        .then(async (response) => {
          if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(request, response.clone());
          }
          return response;
        })
        .catch(() => cached ?? Response.error());
      return cached ?? network;
    })(),
  );
});
