import { openTopBar } from "./lib/topbar.mjs";
/* Production-only checks: independent identities, real Chromium installation,
 * scope ownership, and cold offline starts for every registered PWA. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { chromium } from "playwright";
import { PWA_APPS, webManifest } from "../apps/studio/src/pwa/apps.ts";

const root = resolve("apps/studio/dist");
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");
    let file = resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (file !== root && !file.startsWith(root + sep)) {
      response.writeHead(403).end();
      return;
    }
    try {
      if ((await stat(file)).isDirectory()) {
        if (!url.pathname.endsWith("/")) {
          response.writeHead(308, { Location: `${url.pathname}/${url.search}` }).end();
          return;
        }
        file = resolve(file, "index.html");
      }
    } catch {
      if (!extname(file)) file = resolve(root, "index.html");
    }
    const content = await readFile(file);
    response.writeHead(200, {
      "Content-Type": mime[extname(file)] ?? "application/octet-stream",
      "Cache-Control": "no-store",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless",
    });
    response.end(content);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: "chromium" });
const selectors = {
  workspace: ".home-app-card",
  studio: ".studio-dock-shell",
  reader: ".reader-workspace",
  knowledge: ".knowledge-app",
  markets: ".market-atlas",
  media: ".media-studio",
  quant: ".quant-lab",
  manga: ".manga-studio",
  documents: ".document-workspace",
  data: ".data-studio",
  docgen: ".docgen-studio",
  diagram: ".diagram-app",
  works: ".works-app",
};
const ids = new Set();
try {
  for (const app of PWA_APPS) {
    const manifest = await (await fetch(`${origin}${app.manifestUrl}`)).json();
    assert.deepEqual(manifest, webManifest(app), `${app.key}: published manifest drift`);
    assert(!ids.has(manifest.id), `${app.key}: duplicate installation identity`);
    ids.add(manifest.id);
    assert(manifest.start_url.startsWith(manifest.scope));
    for (const other of PWA_APPS.filter((item) => item.key !== app.key))
      assert(!app.scope.startsWith(other.scope), `${app.key}: overlapping scope with ${other.key}`);
    const context = await browser.newContext();
    const errors = [];
    const monitor = (page) => {
      page.on("pageerror", (error) => {
        errors.push(error.message);
        console.error(app.key, error.stack);
      });
      page.on("requestfailed", (request) => {
        if (request.url().startsWith(origin))
          console.error(app.key, request.url(), request.failure()?.errorText);
      });
    };
    let page = await context.newPage();
    monitor(page);
    await page.goto(`${origin}${app.startUrl}`);
    await page.locator(selectors[app.key]).first().waitFor({ timeout: 45_000 });
    await page.waitForFunction(
      (scope) =>
        navigator.serviceWorker.controller !== null &&
        navigator.serviceWorker.controller.scriptURL.includes(
          scope === "/notes/" ? "/notes/sw.js" : "/pwa/sw.js",
        ),
      app.scope,
      { timeout: 45_000 },
    );
    const cdp = await context.newCDPSession(page);
    const parsed = await cdp.send("Page.getAppManifest");
    assert.equal(parsed.manifest.id, `${origin}${app.id}`);
    assert.equal(parsed.manifest.scope, `${origin}${app.scope}`);
    assert.equal(parsed.manifest.startUrl, `${origin}${app.startUrl}`);
    assert.deepEqual(
      parsed.errors.filter((error) => error.critical),
      [],
    );
    // The initial install must not incorrectly announce an update from another worker.
    assert.equal(await page.getByRole("button", { name: "立即更新", exact: true }).count(), 0);
    await page.close();
    await context.setOffline(true);
    page = await context.newPage();
    monitor(page);
    await page.goto(`${origin}${app.startUrl}`);
    await page.locator(selectors[app.key]).first().waitFor({ timeout: 45_000 });
    if (app.key === "quant") {
      await page.locator(".research-run-button:not(:disabled)").waitFor({ timeout: 45_000 });
      await page.getByRole("button", { name: "运行回测", exact: true }).click();
      await page.waitForFunction(
        () => document.querySelector(".research-status")?.textContent.includes("回测完成"),
        null,
        { timeout: 45_000 },
      );
      assert.equal(await page.locator(".research-run-result").count(), 1);
    }
    if (app.key === "diagram") {
      await page.getByRole("button", { name: "系统架构", exact: false }).click();
      await page.locator(".excalidraw").waitFor();
      await page.locator(".diagram-save-state").filter({ hasText: "已保存" }).waitFor();
      assert.match(page.url(), /\/pwa\/diagram\/\?diagram=/u);
      await page.getByRole("button", { name: "整理布局", exact: true }).click();
      await page.getByRole("button", { name: "从 Mermaid 插入", exact: true }).click();
      const code = page.getByRole("dialog", { name: "从 Mermaid 插入", exact: true });
      await code.getByLabel("Mermaid 代码").fill("flowchart LR\nA[离线读取] --> B[本地计算]");
      await code.getByRole("button", { name: "插入图形", exact: true }).click();
      await code.waitFor({ state: "hidden" });
      await page.locator(".diagram-save-state").filter({ hasText: "已保存" }).waitFor();
      assert.equal(await page.getByRole("alert").count(), 0);
    }
    if (app.key === "works") {
      await page.getByRole("button", { name: "新建作品", exact: true }).click();
      await page.getByLabel("作品文件内容").waitFor();
      assert.match(page.url(), /\/pwa\/works\/\?work=/u);
      await page.getByRole("button", { name: "运行", exact: true }).click();
      await page
        .frameLocator('iframe[title^="作品预览"]')
        .getByRole("heading", { name: "从一个想法开始" })
        .waitFor();
      assert.equal(await page.getByRole("alert").count(), 0);
    }
    if (app.key === "knowledge") {
      await page.getByRole("button", { name: "新建笔记", exact: true }).click();
      await page.getByLabel("笔记正文", { exact: true }).fill("首次离线打开笔记仍可编辑。");
      await page
        .locator('[data-testid="knowledge-status"] .knowledge-status-line')
        .filter({ hasText: /^已保存/u })
        .waitFor({ state: "attached" });
    }
    assert.deepEqual(errors, [], `${app.key}: runtime errors`);
    await context.close();
    console.log(`PASS: ${app.key} identity, scoped worker and offline cold start`);
  }

  // Install and launch both real applications in both orders. Reading manifests
  // alone would miss the reported "Notes replaced Reader" regression.
  const cdp = await browser.newBrowserCDPSession();
  for (const order of [
    ["reader", "knowledge"],
    ["knowledge", "reader"],
  ]) {
    const installed = [];
    try {
      for (const key of order) {
        const app = PWA_APPS.find((item) => item.key === key);
        await cdp.send("PWA.install", {
          manifestId: `${origin}${app.id}`,
          installUrlOrBundleUrl: `${origin}${key === "knowledge" && order[0] === "reader" ? "/knowledge" : app.startUrl}`,
        });
        installed.push(app);
      }
      for (const app of installed) {
        await cdp.send("PWA.getOsAppState", { manifestId: `${origin}${app.id}` });
        const { targetId } = await cdp.send("PWA.launch", { manifestId: `${origin}${app.id}` });
        // launch creates a target before its navigation commits.
        const deadline = Date.now() + 15_000;
        let launchedUrl = "";
        while (Date.now() < deadline) {
          launchedUrl = (await cdp.send("Target.getTargetInfo", { targetId })).targetInfo.url;
          if (launchedUrl === `${origin}${app.startUrl}`) break;
          await new Promise((done) => setTimeout(done, 100));
        }
        assert.equal(launchedUrl, `${origin}${app.startUrl}`);
        await cdp.send("Target.closeTarget", { targetId });
      }
      console.log(`PASS: actual install and independent launch ${order.join(" → ")}`);
    } finally {
      for (const app of installed)
        await cdp.send("PWA.uninstall", { manifestId: `${origin}${app.id}` });
    }
  }

  const context = await browser.newContext();
  const page = await context.newPage();
  // Legacy root worker must yield to dedicated workers without wiping storage.
  await page.goto(`${origin}/knowledge`);
  await page.locator(".knowledge-app").waitFor();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  assert.equal(
    await page.locator('link[rel="manifest"]').getAttribute("href"),
    "/notes/manifest.webmanifest",
  );
  await page.evaluate(() => localStorage.setItem("pwa-migration-probe", "preserved"));
  await page.goto(`${origin}/pwa/reader/`);
  await page.locator(".reader-workspace").waitFor();
  await page.waitForFunction(() =>
    navigator.serviceWorker.controller?.scriptURL.endsWith("/pwa/sw.js?app=reader"),
  );
  assert.equal(await page.evaluate(() => localStorage.getItem("pwa-migration-probe")), "preserved");
  await page.goto(`${origin}/notes/knowledge/`);
  await page.locator(".knowledge-app").waitFor();
  await page.waitForFunction(() =>
    navigator.serviceWorker.controller?.scriptURL.endsWith("/notes/sw.js"),
  );
  assert.equal(await page.evaluate(() => localStorage.getItem("pwa-migration-probe")), "preserved");
  await page.goto(`${origin}/pwa/media/`);
  await page.locator(".media-studio").waitFor();
  await openTopBar(page);
  await page.getByRole("button", { name: "返回工作区主页", exact: true }).click();
  await page.waitForURL(`${origin}/`);
  await page.locator(".home-app-card").first().waitFor();
  assert.equal(await page.locator('link[rel="manifest"]').count(), 0);
  // A direct deep link can initially receive the deployment's generic SPA
  // fallback; bootstrap must still select the workspace's scoped registration.
  await page.goto(`${origin}/pwa/workspace/knowledge`);
  await page.locator(".knowledge-app").waitFor();
  await page.waitForFunction(() =>
    navigator.serviceWorker.controller?.scriptURL.endsWith("/pwa/sw.js?app=workspace"),
  );
  await page.getByRole("button", { name: "新建笔记", exact: true }).click();
  await page.waitForURL(/\/pwa\/workspace\/knowledge\?note=/u);
  assert.equal(
    await page.locator('link[rel="manifest"]').getAttribute("href"),
    "/pwa/workspace/manifest.webmanifest",
  );
  await openTopBar(page);
  await page.getByRole("button", { name: "工作区选项", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "安装工作区", exact: true }).count(), 1);
  await context.close();
  console.log("PASS: legacy worker handoff, shared data and scoped navigation");
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
console.log("independent PWA verification PASSED");
