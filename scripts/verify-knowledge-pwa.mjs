/* Production assets only: no Vite dev server or source-module imports. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { chromium } from "playwright";

const root = resolve("apps/studio/dist");
const worker = await readFile(resolve(root, "notes/sw.js"), "utf8");
const buildId = worker.match(/[`"'](\d{13})[`"']/u)?.[1];
assert(buildId, "Build BCR Studio before running the Notes PWA check");
let version = 0;
const unavailable = new Set();
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
};
// Mimic Workers static assets: auto-trailing-slash redirects for the notes
// directories, directory indexes for `/notes/` and `/notes/knowledge/`, and
// SPA fallback for the host's own routes (embedded `/knowledge` must survive).
const redirects = { "/notes": "/notes/", "/notes/knowledge": "/notes/knowledge/" };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    response.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
    response.setHeader("Cache-Control", "no-store");
    if (unavailable.has(pathname)) {
      response.writeHead(503).end();
      return;
    }
    const redirect = redirects[pathname];
    if (redirect !== undefined) {
      response.writeHead(308, { Location: redirect }).end();
      return;
    }
    if (pathname === "/notes/sw.js") {
      response.setHeader("Content-Type", "text/javascript");
      response.end(worker.replaceAll(buildId, String(Number(buildId) + version)));
      return;
    }
    const file = resolve(
      root,
      pathname === "/" || pathname === "/reader" || pathname === "/knowledge"
        ? "index.html"
        : pathname === "/notes/"
          ? "notes/index.html"
          : pathname === "/notes/knowledge/"
            ? "notes/knowledge/index.html"
            : `.${pathname}`,
    );
    if (!file.startsWith(root + sep)) {
      response.writeHead(403).end();
      return;
    }
    const content = await readFile(file);
    response.setHeader("Content-Type", types[extname(file)] ?? "application/octet-stream");
    response.end(content);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
let page = await context.newPage();
page.setDefaultTimeout(30_000);
const errors = [];
const monitor = (tab) => tab.on("pageerror", (error) => errors.push(error.message));
monitor(page);

try {
  // Install the host Reader shell first: the notes worker must take over its
  // narrower scope even when the wider `/` worker is already active.
  await page.goto(`${origin}/`);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(
    () => navigator.serviceWorker.controller?.scriptURL.endsWith("/sw.js") === true,
  );
  await page.close();

  page = await context.newPage();
  monitor(page);
  await page.goto(`${origin}/notes/`);
  // `/notes/` is a static hand-off page; the app lives at `/notes/knowledge/`.
  await page.waitForURL("**/notes/knowledge/");
  await page.locator(".knowledge-app").waitFor();
  await page.waitForFunction(
    () => navigator.serviceWorker.controller?.scriptURL.endsWith("/notes/sw.js") === true,
    { timeout: 30_000 },
  );

  const manifest = await page.evaluate(async () => {
    const response = await fetch("/notes/manifest.webmanifest");
    const json = await response.json();
    const reachable = await Promise.all(json.icons.map(async (icon) => (await fetch(icon.src)).ok));
    return { json, reachable };
  });
  assert.equal(manifest.json.id, "/notes/");
  assert.equal(manifest.json.start_url, "/notes/knowledge/");
  assert.equal(manifest.json.scope, "/notes/");
  assert.equal(manifest.json.display, "standalone");
  assert.deepEqual(manifest.reachable, [true, true], "manifest icons must resolve");

  await page.getByRole("button", { name: "新建笔记", exact: true }).click();
  await page.getByLabel("笔记标题", { exact: true }).fill("独立 PWA 冒烟笔记");
  await page.getByLabel("笔记标题", { exact: true }).waitFor({ state: "visible" });
  // The standalone entry shares the host's OPFS stores; give the store a beat
  // to persist the new note before the offline boot.
  await page.waitForTimeout(1_000);
  await page.close();

  // Close everything, boot a fresh document with the network disabled.
  await context.setOffline(true);
  page = await context.newPage();
  monitor(page);
  await page.goto(`${origin}/notes/knowledge/`);
  await page.locator(".knowledge-app").waitFor();
  await page.getByLabel("笔记标题", { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel("笔记标题", { exact: true }).inputValue(),
    "独立 PWA 冒烟笔记",
    "offline boot must restore the shared knowledge store",
  );
  await context.setOffline(false);

  // An incomplete release cannot replace the working notes shell cache.
  version = 1;
  unavailable.add("/build-manifest.json");
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration("/notes/");
    await registration.update();
    const installing = registration.installing;
    if (installing && installing.state !== "redundant")
      await new Promise((done) =>
        installing.addEventListener("statechange", () => {
          if (installing.state === "redundant") done();
        }),
      );
  });
  assert.equal(
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration("/notes/");
      return registration.waiting === null;
    }),
    true,
  );
  assert.equal(
    await page.evaluate(
      async (id) => (await caches.keys()).includes(`bcr-knowledge-shell-${id}`),
      String(Number(buildId) + version),
    ),
    false,
  );
  unavailable.clear();

  // The embedded host route must be untouched by the new sub-path app.
  await page.goto(`${origin}/knowledge`);
  await page.locator(".knowledge-app").waitFor();
  await page.locator(".studio-topbar").waitFor();

  assert.deepEqual(errors, []);
  console.log(
    "Notes production PWA PASSED: scope takeover over the Reader worker, /notes/ hand-off, manifest + icons, offline boot with shared store, atomic install rejection, embedded /knowledge intact",
  );
} catch (error) {
  await mkdir("scripts/shots", { recursive: true });
  await page.screenshot({ path: "scripts/shots/notes-pwa-failure.png" }).catch(() => {});
  console.error("page errors", errors);
  console.error(
    await page
      .locator("body")
      .innerText({ timeout: 5_000 })
      .catch((reason) => `unavailable: ${reason.message}`),
  );
  throw error;
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
