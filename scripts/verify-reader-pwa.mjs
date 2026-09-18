/* Production assets only: no Vite dev server or source-module imports. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { chromium } from "playwright";

const root = resolve("apps/studio/dist");
const worker = await readFile(resolve(root, "sw.js"), "utf8");
const buildId = worker.match(/[`"'](\d{13})[`"']/u)?.[1];
assert(buildId, "Build BCR Studio before running the production PWA check");
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
    if (pathname === "/probe") {
      response.setHeader("Content-Type", "text/html");
      response.end("<!doctype html><title>Old client</title>");
      return;
    }
    if (pathname === "/sw.js") {
      response.setHeader("Content-Type", "text/javascript");
      response.end(worker.replaceAll(buildId, String(Number(buildId) + version)));
      return;
    }
    const file = resolve(
      root,
      pathname === "/" || pathname === "/reader" ? "index.html" : `.${pathname}`,
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
// Exercise the installed Reader entry without booting an unrelated Studio lease.
await context.addInitScript(() => {
  const original = window.matchMedia.bind(window);
  window.matchMedia = (query) =>
    query === "(display-mode: standalone)"
      ? Object.defineProperty(original(query), "matches", { value: true })
      : original(query);
});
let page = await context.newPage();
page.setDefaultTimeout(30_000);
const errors = [];
const monitor = (tab) => tab.on("pageerror", (error) => errors.push(error.message));
monitor(page);
const session = (tab) =>
  tab.evaluate(() => JSON.parse(localStorage.getItem("bcr.reader.session.v1")));
try {
  await page.goto(`${origin}/reader`);
  await page.locator(".reader-workspace").waitFor();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.getByLabel("导入阅读文件").setInputFiles({
    name: "pwa-book.html",
    mimeType: "text/html",
    buffer: Buffer.from(
      `<html><head><title>PWA durable reading</title></head><body>${Array.from({ length: 100 }, (_, i) => `<p>Paragraph ${i}. ${"Offline reading preserves this position. ".repeat(15)}</p>`).join("")}</body></html>`,
    ),
  });
  await page.getByText("导入完成", { exact: true }).waitFor();
  await page.locator(".reader-reading-scroll").evaluate((element) => {
    element.scrollTop = 1400;
  });
  await page.waitForFunction(() => {
    const saved = JSON.parse(localStorage.getItem("bcr.reader.session.v1"));
    return saved?.progressByBook[saved.activeBookId]?.percentage > 0;
  });
  const before = await session(page);
  assert(before.activeBookId.startsWith("book-"));

  // Another tab must not reach an editable Reader or mutate the session mirror.
  const second = await context.newPage();
  await second.goto(`${origin}/reader`);
  await second.getByText(/Reader 已在其他页面打开/u).waitFor();
  assert.equal(await second.locator(".reader-workspace").count(), 0);
  assert.deepEqual((await session(second)).progressByBook, before.progressByBook);
  await page.close();
  await second.getByRole("button", { name: "重试打开" }).click();
  await second.locator(".reader-workspace").waitFor();
  page = second;
  monitor(page);
  assert.equal((await session(page)).activeBookId, before.activeBookId);

  // Close the page entirely, then boot a fresh document with the network disabled.
  await page.close();
  await context.setOffline(true);
  page = await context.newPage();
  monitor(page);
  await page.goto(`${origin}/reader`);
  await page.locator(".reader-workspace").waitFor();
  await page.getByRole("heading", { name: "PWA durable reading", exact: true }).waitFor();
  assert.equal((await session(page)).activeBookId, before.activeBookId);
  assert((await session(page)).progressByBook[before.activeBookId].percentage > 0);
  await context.setOffline(false);

  // An incomplete release cannot replace the working shell cache.
  version = 1;
  unavailable.add("/build-manifest.json");
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    await registration.update();
    const worker = registration.installing;
    if (worker && worker.state !== "redundant")
      await new Promise((done) =>
        worker.addEventListener("statechange", () => {
          if (worker.state === "redundant") done();
        }),
      );
  });
  assert.equal(
    await page.evaluate(async () => (await navigator.serviceWorker.ready).waiting === null),
    true,
  );
  assert.equal(
    await page.evaluate(
      async (id) => (await caches.keys()).includes(`bcr-reader-shell-${id}`),
      String(Number(buildId) + version),
    ),
    false,
  );
  unavailable.clear();

  const oldClient = await context.newPage();
  await oldClient.goto(`${origin}/probe`);
  version = 2;
  await page.evaluate(async () => {
    await (await navigator.serviceWorker.ready).update();
  });
  await page.getByRole("button", { name: "立即更新", exact: true }).waitFor();
  // Fail both metadata backends. The new worker must remain waiting.
  await page.evaluate(() => {
    const setItem = Storage.prototype.setItem;
    const createWritable = FileSystemFileHandle.prototype.createWritable;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("bcr.reader.")) throw new DOMException("full", "QuotaExceededError");
      return setItem.call(this, key, value);
    };
    FileSystemFileHandle.prototype.createWritable = function (...args) {
      if (this.name === "meta.db")
        return Promise.reject(new DOMException("full", "QuotaExceededError"));
      return createWritable.apply(this, args);
    };
    window.restoreWrites = () => {
      Storage.prototype.setItem = setItem;
      FileSystemFileHandle.prototype.createWritable = createWritable;
    };
    window.updateProbe = true;
  });
  await page.getByRole("button", { name: "立即更新", exact: true }).click();
  await page.locator(".reader-save-notice").waitFor();
  await page.waitForFunction(
    () => document.querySelector(".reader-update-actions .is-primary")?.disabled === false,
  );
  assert(await page.evaluate(() => window.updateProbe === true));
  assert(await page.evaluate(async () => (await navigator.serviceWorker.ready).waiting !== null));
  await page.evaluate(() => window.restoreWrites());
  const savedPosition = await session(page);
  await Promise.all([
    page.waitForEvent("load"),
    page.getByRole("button", { name: "立即更新", exact: true }).click(),
  ]);
  await page.locator(".reader-workspace").waitFor();
  await page.getByRole("heading", { name: "PWA durable reading", exact: true }).waitFor();
  assert.equal((await session(page)).activeBookId, savedPosition.activeBookId);
  const restoredPosition = (await session(page)).progressByBook[savedPosition.activeBookId];
  assert(
    Math.abs(
      restoredPosition.percentage -
        savedPosition.progressByBook[savedPosition.activeBookId].percentage,
    ) < 0.02,
    "update lost the saved reading position",
  );
  const cacheNames = await page.evaluate(() => caches.keys());
  assert(cacheNames.includes(`bcr-reader-shell-${Number(buildId) + version}`));
  assert(
    cacheNames.includes(`bcr-reader-shell-${buildId}`),
    "previous release cache must remain available",
  );
  // Old clients may still request a hashed chunk removed from the deployment.
  const cachedAsset = await page.evaluate(async (id) => {
    const cache = await caches.open(`bcr-reader-shell-${id}`);
    return (await cache.keys())
      .map((request) => new URL(request.url).pathname)
      .find((path) => path.endsWith(".js"));
  }, buildId);
  assert(cachedAsset);
  await page.evaluate(
    async ({ id, path }) => {
      await (await caches.open(`bcr-reader-shell-${id}`)).delete(path);
    },
    { id: Number(buildId) + version, path: cachedAsset },
  );
  unavailable.add(cachedAsset);
  assert(await oldClient.evaluate(async (path) => (await fetch(path)).ok, cachedAsset));
  unavailable.clear();
  await oldClient.close();
  // Installed Reader forwards a selection into the host collection store in
  // the same tab, retaining the source identity across the bootstrap change.
  await page
    .locator(".reader-prose p")
    .first()
    .evaluate((element) => {
      const node = document.createTreeWalker(element, NodeFilter.SHOW_TEXT).nextNode();
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, 9);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });
  await page.getByRole("button", { name: "加入资料集合", exact: true }).click();
  await page.getByRole("dialog", { name: "保存选段", exact: true }).waitFor();
  await page.getByLabel("集合名称", { exact: true }).fill("PWA collection");
  await page.getByRole("button", { name: "保存到集合", exact: true }).click();
  await page.getByText("已加入资料集合", { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "Reader production PWA PASSED: exclusive writer, reopen, offline cold boot, incomplete update, failed-save guard, update recovery, old asset cache",
  );
} catch (error) {
  await mkdir("scripts/shots", { recursive: true });
  await page.screenshot({ path: "scripts/shots/reader-pwa-failure.png" }).catch(() => {});
  console.error("page errors", errors);
  console.error(await page.locator("body").innerText());
  throw error;
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
