/* Exercise real production imports and workers against deployment failure responses. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { startPwaServer } from "./lib/pwa-server.mjs";

const worker = await readFile("apps/studio/dist/sw.js", "utf8");
const buildId = worker.match(/[`"'](\d{13})[`"']/u)?.[1];
assert(buildId, "Build Studio before testing update recovery");
const manifest = JSON.parse(await readFile("apps/studio/dist/build-manifest.json", "utf8"));
const diagram = Object.values(manifest).find((entry) =>
  /\/DiagramApp-[^/]+\.js$/u.test(entry.file),
);
assert(diagram, "Diagram must remain a lazy workspace");
let version = 0;
const unavailable = new Set();
const htmlFallback = new Set();
const server = await startPwaServer({
  async respond(request, response, root) {
    const path = new URL(request.url, "http://localhost").pathname;
    if (unavailable.has(path)) {
      response.writeHead(503, { "Cache-Control": "no-store" }).end();
      return true;
    }
    if (htmlFallback.has(path)) {
      response.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" });
      response.end(await readFile(resolve(root, "index.html")));
      return true;
    }
    if (path === "/sw.js") {
      response.writeHead(200, { "Content-Type": "text/javascript", "Cache-Control": "no-store" });
      response.end(worker.replaceAll(buildId, String(Number(buildId) + version)));
      return true;
    }
    return false;
  },
});
const browser = await chromium.launch();
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  await page.goto(`${server.origin}/knowledge`);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.getByRole("button", { name: "新建笔记", exact: true }).click();
  await page.getByLabel("笔记标题", { exact: true }).fill("更新恢复后保留的笔记");
  await page.getByLabel("笔记正文", { exact: true }).fill("绘图分块失效不能卸载正在编辑的笔记。");
  await page.keyboard.press("Alt+0");
  await page.getByRole("button", { name: "工作区选项", exact: true }).click();
  await page
    .getByRole("dialog", { name: "工作区选项", exact: true })
    .getByRole("button", { name: "检查更新", exact: true })
    .click();
  await page.getByText("当前已是最新版本", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("应用更新", { exact: true }).getByRole("button").count(), 0);
  await page.getByLabel("应用更新", { exact: true }).waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "工作区选项", exact: true }).click();
  const versionInfo = page.getByLabel("应用版本", { exact: true });
  assert.match(await versionInfo.innerText(), /当前版本 \d{8}\.\d{6}/u);
  assert.match(await versionInfo.innerText(), /上次检查/u);
  await page
    .getByRole("dialog", { name: "工作区选项", exact: true })
    .getByRole("button", { name: /^安装/u })
    .click();
  await page.locator("dialog[open]").getByRole("button", { name: "检查更新", exact: true }).click();
  await page.locator("dialog[open]").waitFor({ state: "hidden" });
  await page.getByText("当前已是最新版本", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("应用更新", { exact: true }).getByRole("button").count(), 0);
  await page.getByLabel("应用更新", { exact: true }).waitFor({ state: "hidden" });

  // New release plus an uncached, removed lazy module. Failed installs must be
  // visible and retryable, without unmounting the existing Knowledge editor.
  version++;
  unavailable.add("/build-manifest.json");
  htmlFallback.add(`/${diagram.file}`);
  await page.locator(".home-app-card").filter({ hasText: "绘图" }).click();
  const failure = page.getByRole("region", { name: "绘图加载失败", exact: true });
  await failure.waitFor();
  assert.equal(await failure.locator("pre").isVisible(), false);
  await failure.getByText("错误详情", { exact: true }).click();
  assert.match(
    await failure.locator("pre").innerText(),
    /Failed to fetch dynamically imported module/u,
  );
  await page.getByText("更新未完成", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("笔记标题", { exact: true }).count(), 1);
  assert.equal(
    await page.getByLabel("笔记标题", { exact: true }).inputValue(),
    "更新恢复后保留的笔记",
  );
  assert.equal(
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).waiting),
    null,
  );

  unavailable.clear();
  htmlFallback.clear();
  // A 200 HTML fallback in the *new* shell must also reject the release.
  const css = manifest["src/studio-main.tsx"].css[0];
  assert(css);
  htmlFallback.add(`/${css}`);
  await page.getByRole("button", { name: "重试检查更新", exact: true }).click();
  await page.getByText("更新未完成", { exact: true }).waitFor();
  assert.equal(
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).waiting),
    null,
  );
  htmlFallback.clear();
  await page.getByRole("button", { name: "重试检查更新", exact: true }).click();
  await page.getByRole("button", { name: "立即更新", exact: true }).waitFor();
  await Promise.all([
    page.waitForEvent("load"),
    page.getByRole("button", { name: "立即更新", exact: true }).click(),
  ]);
  await page.locator(".diagram-app").waitFor();
  await page.keyboard.press("Alt+4");
  await page.getByLabel("笔记标题", { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel("笔记标题", { exact: true }).inputValue(),
    "更新恢复后保留的笔记",
  );
  assert.equal(
    await page.getByLabel("笔记正文", { exact: true }).innerText(),
    "绘图分块失效不能卸载正在编辑的笔记。",
  );
  await context.close();

  // A failed first registration leaves no worker. Manual retry must register
  // again, not wait forever on navigator.serviceWorker.ready or a stale handle.
  const fresh = await browser.newContext();
  const first = await fresh.newPage();
  unavailable.add("/sw.js");
  await first.goto(server.origin);
  await first.getByRole("button", { name: "工作区选项", exact: true }).click();
  await first
    .getByRole("dialog", { name: "工作区选项", exact: true })
    .getByRole("button", { name: "检查更新", exact: true })
    .click();
  await first.getByText("更新未完成", { exact: true }).waitFor();
  unavailable.clear();
  await first.keyboard.press("Escape");
  await first.getByRole("button", { name: "重试检查更新", exact: true }).click();
  await first.getByText("当前已是最新版本", { exact: true }).waitFor();
  await first.waitForFunction(() => navigator.serviceWorker.controller !== null);
  assert.equal(await first.getByRole("button", { name: "立即更新", exact: true }).count(), 0);
  await fresh.setOffline(true);
  await first.getByRole("button", { name: "工作区选项", exact: true }).click();
  await first
    .getByRole("dialog", { name: "工作区选项", exact: true })
    .getByRole("button", { name: "检查更新", exact: true })
    .click();
  await first.getByText("当前离线，请联网后重试检查更新。", { exact: true }).waitFor();
  await fresh.setOffline(false);
  await first.keyboard.press("Escape");
  htmlFallback.add(`/${diagram.file}`);
  await first.locator(".home-app-card").filter({ hasText: "绘图" }).click();
  // A transient module failure on the current release needs a safe reload,
  // never a false "new version" claim or an automatic reload loop.
  await first.getByRole("button", { name: "保存并重新加载", exact: true }).waitFor();
  assert.equal(await first.getByRole("button", { name: "立即更新", exact: true }).count(), 0);
  htmlFallback.clear();
  await Promise.all([
    first.waitForEvent("load"),
    first.getByRole("button", { name: "保存并重新加载", exact: true }).click(),
  ]);
  await first.locator(".diagram-app").waitFor();
  await fresh.close();
  console.log(
    "Production update recovery PASSED: manual check, stale lazy import, retry, HTML rejection, retained notes, failed first install and offline status",
  );
} finally {
  await browser.close();
  await server.close();
}
