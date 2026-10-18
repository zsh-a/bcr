const BUILD_ID = globalThis.__BCR_READER_BUILD_ID__;
const CACHE_PREFIX = "bcr-reader-shell-";
const CACHE_NAME = `${CACHE_PREFIX}${BUILD_ID}`;
const BUILD_MANIFEST = "/build-manifest.json";
const NETWORK_TIMEOUT_MS = 2_000;
const INSTALL_TIMEOUT_MS = 60_000;
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
  return !/pdf\.worker|sqlite3(?:-opfs-async-proxy)?|\.wasm$|MiSans-|noto-serif-sc-/u.test(url);
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

// Keep this installer in sync across the three worker entries. The root worker
// is classic; keep its installer self-contained.
async function installResource(url, init, consume) {
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), INSTALL_TIMEOUT_MS);
    let retryable = true;
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      const fallbackHtml =
        url.startsWith("/assets/") &&
        (response.headers.get("content-type") ?? "").includes("text/html");
      if (!response.ok || fallbackHtml) {
        retryable =
          !fallbackHtml &&
          (response.status === 408 || response.status === 429 || response.status >= 500);
        throw new Error(`Shell resource unavailable: ${url} (${response.status})`);
      }
      // Keep the deadline active until the body is parsed or written to cache,
      // not just until fetch resolves with response headers.
      return await consume(response);
    } catch (reason) {
      if (!retryable || attempt >= 2)
        throw new Error(`Shell resource download failed: ${url}`, { cause: reason });
    } finally {
      clearTimeout(timeout);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000 * (attempt + 1)));
  }
}

async function shellUrls() {
  const manifest = await installResource(BUILD_MANIFEST, { cache: "no-store" }, (response) =>
    response.json(),
  );
  const urls = new Set(APP_SHELL);
  urls.add(BUILD_MANIFEST);
  const visited = new Set();
  // 工作区外壳在引导时按 URL 分流到 Reader 或 Studio；两条静态图都要随外壳
  // 原子预缓存。重度按需资产（PDF worker、sqlite 代理、wasm）仍走运行时缓存。
  addManifestEntry(manifest, "index.html", urls, visited);
  addManifestEntry(manifest, "src/reader-main.tsx", urls, visited);
  addManifestEntry(manifest, "src/studio-main.tsx", urls, visited);
  return [...urls];
}

async function stageShell() {
  // Publish only a complete shell. Limit active downloads so browser queues do
  // not consume every request's deadline before it even reaches the network.
  await caches.delete(CACHE_NAME);
  const cache = await caches.open(CACHE_NAME);
  try {
    const urls = await shellUrls();
    let next = 0;
    let failed = false;
    const downloads = Array.from({ length: Math.min(6, urls.length) }, async () => {
      while (!failed && next < urls.length) {
        const url = urls[next++];
        try {
          await installResource(url, { cache: "reload" }, (response) =>
            cache.put(new Request(url), response),
          );
        } catch (reason) {
          failed = true;
          throw reason;
        }
      }
    });
    // Let in-flight writes settle before deleting a failed staging cache.
    const results = await Promise.allSettled(downloads);
    const failure = results.find((result) => result.status === "rejected");
    if (failure) throw failure.reason;
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
      const previous = generatedCandidates.slice(0, 1);
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
    // The Notes PWA owns /notes/ through its own scoped service worker. Until
    // that worker is registered this shell must stay out of the way: serving
    // the Studio SPA under a notes address would boot the wrong router.
    if (
      url.pathname === "/notes" ||
      url.pathname.startsWith("/notes/") ||
      url.pathname === "/pwa" ||
      url.pathname.startsWith("/pwa/")
    ) {
      event.respondWith(
        refreshAllowed()
          ? fetchWithTimeout(request).catch(() => Response.error())
          : Response.error(),
      );
      return;
    }
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
      const network = fetchWithTimeout(
        request,
        {},
        cached === undefined ? INSTALL_TIMEOUT_MS : NETWORK_TIMEOUT_MS,
      )
        .then(async (response) => {
          // SPA 兜底会以 200 + text/html 应答缺失的 /assets/ 请求；把它当失败，
          // 绝不写进缓存——写进去就是永久的「Unable to preload CSS/JS」。
          const type = response.headers.get("content-type") ?? "";
          const fallbackHtml = url.pathname.startsWith("/assets/") && type.includes("text/html");
          if (fallbackHtml) return cached ?? Response.error();
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
