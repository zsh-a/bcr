import { receiveShare } from "../pwa/share-target";
const BUILD_ID = globalThis.__BCR_NOTES_BUILD_ID__;
const CACHE_PREFIX = "bcr-knowledge-shell-";
const CACHE_NAME = `${CACHE_PREFIX}${BUILD_ID}`;
const BUILD_MANIFEST = "/build-manifest.json";
const NETWORK_TIMEOUT_MS = 2_000;
const INSTALL_TIMEOUT_MS = 60_000;
const APP_SHELL = [
  "/notes/",
  "/notes/knowledge/",
  "/notes/manifest.webmanifest",
  "/icons/knowledge-icon-192.png",
  "/icons/knowledge-icon-512.png",
];

function isRequiredNotesAsset(url) {
  // Notes 的 runtime 启动即加载 sqlite 及其 OPFS 代理，属于关键路径，必须随
  // 外壳预缓存；只有阅读 / 媒体域的重资源（PDF worker、本地模型）
  // 不在知识库启动图里，留给运行时缓存。
  // 中文字库按可见字符分片请求，再由 fetch handler 缓存；预缓存全部
  // 分片会下载整套字库，抵消 unicode-range 与按需衬线字体的作用。
  return !/pdf\.worker|onnxruntime|transformers|IBMPlexSansSC-|noto-serif-sc-/u.test(url);
}

function addAsset(urls, value) {
  if (typeof value !== "string") return;
  const normalized = `/assets/${value.replace(/^\/?assets\//, "")}`;
  if (isRequiredNotesAsset(normalized)) urls.add(normalized);
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
// is classic, so sharing an ES module here would break existing registrations.
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
  // 只预缓存 Notes 独立入口的模块图；宿主 Studio 的其余应用保持按需加载。
  addManifestEntry(manifest, "notes/knowledge/index.html", urls, visited);
  // Export and restore must work even when their first use is offline.
  addManifestEntry(manifest, "src/knowledge/storage/backupArchive.ts", urls, visited);
  for (const key of Object.keys(manifest)) {
    if (key.endsWith("/bcr_kernels_bg.wasm")) addManifestEntry(manifest, key, urls, visited);
  }
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

async function knowledgeCacheNames() {
  const keys = await caches.keys();
  return keys.filter((key) => key.startsWith(CACHE_PREFIX));
}

function notesPath(url) {
  // 目录型地址与无斜杠变体都归一到预缓存的 shell 键上。
  if (url.pathname === "/notes") return "/notes/";
  if (url.pathname === "/notes/knowledge") return "/notes/knowledge/";
  return url.pathname;
}

async function matchCached(request, pathname) {
  const current = await caches.open(CACHE_NAME);
  const pathRequest = new Request(pathname);
  const currentMatch =
    (await current.match(request, { ignoreVary: true })) ??
    (await current.match(pathRequest, { ignoreSearch: true, ignoreVary: true }));
  if (currentMatch !== undefined) return currentMatch;

  // 保住激活后仍开着的旧标签页：它们的懒加载 chunk 可能仍指向上一个版本。
  const fallbackNames = (await knowledgeCacheNames())
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
  // 不在这里 skipWaiting：与 Reader 一致，先经用户确认再替换运行中的版本。
  event.waitUntil(stageShell());
});

globalThis.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") event.waitUntil(globalThis.skipWaiting());
});

globalThis.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await knowledgeCacheNames();
      const generated = names
        .filter((name) => name !== CACHE_NAME && /^\d+$/u.test(name.slice(CACHE_PREFIX.length)))
        .sort()
        .reverse();
      // 保留上一个时间戳版本，让已打开的旧标签页能继续取到旧 chunk。
      const retained = new Set([CACHE_NAME, ...generated.slice(0, 1)]);
      await Promise.all(
        names.filter((name) => !retained.has(name)).map((name) => caches.delete(name)),
      );
      await globalThis.clients.claim();
    })(),
  );
});

globalThis.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    request.method === "POST" &&
    url.origin === globalThis.location.origin &&
    url.pathname === "/notes/share"
  ) {
    event.respondWith(receiveShare(request, "knowledge", "/notes/knowledge/"));
    return;
  }
  if (request.method !== "GET" || url.origin !== globalThis.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const pathname = notesPath(url);
        const cached = await matchCached(request, pathname);
        if (cached !== undefined) return cached;
        const shell = await matchCached(new Request("/notes/knowledge/"), "/notes/knowledge/");
        if (shell !== undefined) return shell;
        if (!refreshAllowed()) return Response.error();
        // 导航文档是版本化外壳的一部分：绝不把新部署的 index 写进旧缓存。
        return fetchWithTimeout(request).catch(() => Response.error());
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await matchCached(request, notesPath(url));
      if (cached !== undefined && !refreshAllowed()) return cached;
      const network = fetchWithTimeout(
        request,
        {},
        cached === undefined ? INSTALL_TIMEOUT_MS : NETWORK_TIMEOUT_MS,
      )
        .then(async (response) => {
          if (
            url.pathname.startsWith("/assets/") &&
            (response.headers.get("content-type") ?? "").includes("text/html")
          )
            return cached ?? Response.error();
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
