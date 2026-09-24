import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { chromium } from "playwright";
import { createKnowledgeGitHub } from "./fixtures/knowledge-github.mjs";

const production = process.env.BCR_KNOWLEDGE_PRODUCTION === "1";
let server;
let origin = new URL(process.env.BASE_URL ?? "http://localhost:5199").origin;
if (production) {
  const root = resolve("apps/studio/dist");
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
  server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      const file = resolve(root, !extname(pathname) ? "index.html" : `.${pathname}`);
      if (!file.startsWith(root + sep)) {
        response.writeHead(403).end();
        return;
      }
      response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
      response.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
      response.setHeader("Content-Type", types[extname(file)] ?? "application/octet-stream");
      response.end(await readFile(file));
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  origin = `http://127.0.0.1:${server.address().port}`;
}
const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
const fixture = createKnowledgeGitHub(),
  errors = [],
  diagnostics = [];
async function device() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route("https://api.github.com/**", async (route) => {
    const request = route.request();
    const headers = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, X-GitHub-Api-Version",
    };
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers });
      return;
    }
    try {
      const result = await fixture.handle(
        request.url(),
        request.method(),
        request.postData() ? request.postDataJSON() : undefined,
      );
      await route.fulfill({
        status: result.status,
        headers,
        contentType: "application/json",
        body: JSON.stringify(result.json),
      });
    } catch (error) {
      console.error(
        "Mock GitHub failure",
        request.method(),
        new URL(request.url()).pathname,
        error,
      );
      await route.abort("failed");
    }
  });
  const page = await context.newPage();
  page.setDefaultTimeout(25_000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") diagnostics.push(message.text());
  });
  page.on("requestfailed", (request) =>
    diagnostics.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText}`),
  );
  await page.goto(`${origin}/knowledge`);
  await page.getByRole("heading", { name: "个人知识库", exact: true }).waitFor();
  return { context, page };
}
const saved = (page) =>
  page.locator('.knowledge-editor [role="status"]').filter({ hasText: "已保存到本机" }).waitFor();
async function connect(page) {
  await page.getByRole("button", { name: "GitHub 同步设置", exact: true }).click();
  await page.getByLabel("GitHub 用户或组织").fill("alice");
  await page.getByLabel("GitHub 私有仓库").fill("notes");
  await page.getByLabel("GitHub Token", { exact: true }).fill("secret-browser-token");
  await page.getByRole("button", { name: "保存连接", exact: true }).click();
  await page.getByText(/连接已保存/u).waitFor();
}
async function sync(page, conflict = false) {
  await page.getByRole("button", { name: "立即同步", exact: true }).click();
  await page.getByRole("button", { name: "立即同步", exact: true }).waitFor();
  await page
    .locator(".knowledge-notice")
    .filter({ hasText: conflict ? "发现冲突" : "已与 GitHub 同步" })
    .waitFor();
  assert.equal(await page.locator(".knowledge-notice.is-error").count(), 0);
}
async function body(page, text) {
  await page.getByLabel("笔记正文", { exact: true }).fill(text);
  await saved(page);
}
async function matchesBody(page, text) {
  // The body is a CodeMirror surface, not a <textarea>. Match its rendered
  // lines rather than a `.value` property that no longer exists: CodeMirror
  // wraps each visual line in its own element, so joining `.cm-line` is the
  // faithful read of the document text.
  await page.waitForFunction(
    (expected) =>
      [...document.querySelectorAll('[aria-label="笔记正文"] .cm-line')]
        .map((line) => line.textContent)
        .join("\n") === expected,
    text,
  );
}
let a, b;
try {
  a = await device();
  b = await device();
  await a.page.goto(`${origin}/knowledge?note=__proto__`);
  await a.page.getByRole("button", { name: "新建笔记", exact: true }).click();
  await a.page.getByLabel("笔记标题", { exact: true }).fill("AI Native 知识系统");
  await a.page.getByLabel("笔记标签", { exact: true }).pressSequentially("local, markdown");
  await body(a.page, "# 独立手写知识\n\n第一段\n\n第三段\n");
  await a.page.reload();
  await saved(a.page);
  assert.equal(
    await a.page.getByLabel("笔记标签", { exact: true }).inputValue(),
    "local, markdown",
  );
  await matchesBody(a.page, "# 独立手写知识\n\n第一段\n\n第三段\n");

  await a.page.getByRole("button", { name: "打开全局搜索" }).click();
  await a.page.getByRole("textbox", { name: "全局搜索", exact: true }).fill("独立手写知识");
  await a.page.getByRole("tab", { name: /^个人笔记/u }).click();
  await a.page.getByRole("option").filter({ hasText: "AI Native 知识系统" }).first().click();
  await a.page.getByLabel("笔记正文", { exact: true }).waitFor();

  await connect(a.page);
  await sync(a.page);
  await connect(b.page);
  await sync(b.page);
  await matchesBody(b.page, "# 独立手写知识\n\n第一段\n\n第三段\n");
  await a.page.getByRole("button", { name: "GitHub 同步设置", exact: true }).click();
  await b.page.getByRole("button", { name: "GitHub 同步设置", exact: true }).click();

  await a.context.setOffline(true);
  await body(a.page, "# 独立手写知识\n\n设备 A 的第一段\n\n第三段\n");
  await a.context.setOffline(false);
  await body(b.page, "# 独立手写知识\n\n第一段\n\n设备 B 的第三段\n");
  await sync(a.page);
  await sync(b.page);
  await sync(a.page);
  const merged = "# 独立手写知识\n\n设备 A 的第一段\n\n设备 B 的第三段\n";
  await matchesBody(a.page, merged);
  await matchesBody(b.page, merged);

  await body(a.page, "设备 A 同一段冲突");
  await body(b.page, "设备 B 同一段冲突");
  await sync(a.page);
  await sync(b.page, true);
  await b.page.reload();
  await b.page.getByRole("button", { name: "处理冲突", exact: true }).click();
  assert.equal(await b.page.getByLabel("GitHub Token", { exact: true }).inputValue(), "");
  assert.equal(await b.page.locator(".knowledge-conflict").count(), 1);
  await b.page.getByRole("button", { name: "保留双方", exact: true }).click();
  await b.page.locator(".knowledge-conflict").waitFor({ state: "hidden" });
  await b.page.getByLabel("GitHub Token", { exact: true }).fill("secret-browser-token");
  await b.page.getByRole("button", { name: "保存连接", exact: true }).click();
  await sync(b.page);
  await sync(a.page);
  assert.equal(await a.page.locator(".knowledge-note-card").count(), 2);

  await a.page.getByRole("button", { name: "笔记版本历史", exact: true }).click();
  await a.page.getByRole("button", { name: "读取 GitHub 历史", exact: true }).click();
  await a.page
    .locator(".knowledge-history-list button")
    .filter({ hasText: "GitHub ·" })
    .last()
    .click();
  await a.page.getByRole("button", { name: "恢复此版本", exact: true }).click();
  await matchesBody(a.page, "# 独立手写知识\n\n第一段\n\n第三段\n");
  await a.page.getByRole("button", { name: "笔记版本历史", exact: true }).click();

  // Rendering untrusted Markdown must not execute HTML or fetch remote images.
  let externalImages = 0;
  await a.context.route("https://tracking.invalid/**", (route) => {
    externalImages++;
    return route.abort();
  });
  await body(
    a.page,
    "# 安全预览\n<script>window.knowledgeXss=true</script>\n![private](https://tracking.invalid/pixel)\n[unsafe](javascript:alert(1))",
  );
  await a.page.getByRole("button", { name: "预览", exact: true }).click();
  await a.page.locator(".knowledge-prose h1").waitFor();
  assert.equal(await a.page.evaluate(() => window.knowledgeXss), undefined);
  assert.equal(externalImages, 0);
  assert.equal(await a.page.locator('.knowledge-prose a[href^="javascript:"]').count(), 0);
  await a.page.getByRole("button", { name: "继续编辑", exact: true }).click();
  await body(a.page, merged);

  const downloadEvent = a.page.waitForEvent("download");
  await a.page.getByRole("button", { name: "导出这篇笔记", exact: true }).click();
  const download = await downloadEvent,
    markdown = await readFile(await download.path(), "utf8");
  assert(markdown.includes("bcr: 1") && markdown.endsWith(merged));
  await a.page.getByLabel("导入 Markdown 笔记").setInputFiles({
    name: "imported.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# 导入手写笔记\n\n开放格式保持可读。"),
  });
  await matchesBody(a.page, "# 导入手写笔记\n\n开放格式保持可读。");
  await a.page.getByRole("button", { name: "删除", exact: true }).click();
  await a.page.getByRole("button", { name: "确认删除笔记", exact: true }).click();
  await a.page.getByRole("button", { name: "笔记版本历史", exact: true }).click();
  await a.page.getByLabel("显示全部笔记与删除记录").check();
  await a.page
    .locator(".knowledge-history-list button")
    .filter({ hasText: "删除前版本" })
    .first()
    .click();
  await a.page.getByRole("button", { name: "恢复此版本", exact: true }).click();
  await matchesBody(a.page, "# 导入手写笔记\n\n开放格式保持可读。");
  await a.page.getByRole("button", { name: "笔记版本历史", exact: true }).click();

  await mkdir("scripts/shots", { recursive: true });
  await a.page.screenshot({ path: "scripts/shots/knowledge-desktop.png", fullPage: true });
  await a.page.setViewportSize({ width: 390, height: 844 });
  await a.page.getByRole("button", { name: "打开笔记列表", exact: true }).click();
  await a.page.getByRole("button", { name: "新建笔记", exact: true }).waitFor();
  await a.page.getByRole("button", { name: "收起列表", exact: true }).click();
  await a.page.screenshot({ path: "scripts/shots/knowledge-mobile.png", fullPage: true });
  assert(
    await a.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    "mobile layout overflows horizontally",
  );
  assert(
    !(await a.page.evaluate(() => JSON.stringify(localStorage))).includes("secret-browser-token"),
  );

  // Reader evidence is imported as an editable, independent note with a durable citation.
  await b.page.goto(`${origin}/reader`);
  await b.page.getByLabel("导入阅读文件").setInputFiles({
    name: "knowledge-source.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# 知识来源\n\n独特引用证据，用于知识库整理。"),
  });
  await b.page.getByText("导入完成", { exact: true }).waitFor();
  await b.page.getByRole("button", { name: "打开全局搜索" }).click();
  await b.page.getByRole("textbox", { name: "全局搜索", exact: true }).fill("独特引用证据");
  await b.page.getByRole("tab", { name: /^阅读器/u }).click();
  await b.page.getByRole("option").filter({ hasText: "独特引用证据" }).first().waitFor();
  await b.page.getByRole("button", { name: /资料集合 ·/u }).click();
  await b.page.getByLabel("新集合名称").fill("引文与思考");
  await b.page.getByRole("button", { name: "创建集合", exact: true }).click();
  await b.page.getByRole("status").filter({ hasText: "已保存到本地" }).waitFor();
  await b.page.getByRole("button", { name: "工作区搜索", exact: true }).click();
  await b.page.getByRole("button", { name: "保存当前结果", exact: true }).click();
  await b.page.getByRole("status").filter({ hasText: "已保存到本地" }).waitFor();
  await b.page.goto(`${origin}/knowledge`);
  await b.page.getByText("导入、导出与备份", { exact: true }).click();
  await b.page.getByRole("button", { name: "从资料集合导入", exact: true }).click();
  await b.page.locator(".knowledge-note-card").filter({ hasText: "独特引用证据" }).click();
  await b.page.locator(".knowledge-citations").waitFor();
  // Read the editor's rendered lines, not a textarea `.value`.
  const importedBody = await b.page.evaluate(() =>
    [...document.querySelectorAll('[aria-label="笔记正文"] .cm-line')]
      .map((line) => line.textContent)
      .join("\n"),
  );
  assert(importedBody.includes("> 独特引用证据"));
  await body(b.page, "独特引用证据的手写整理，不应被重复导入覆盖。");
  const importedCount = await b.page.locator(".knowledge-note-card").count();
  await b.page.getByRole("button", { name: "从资料集合导入", exact: true }).click();
  await b.page.getByText(/已有条目保留原笔记/u).waitFor();
  assert.equal(await b.page.locator(".knowledge-note-card").count(), importedCount);
  await matchesBody(b.page, "独特引用证据的手写整理，不应被重复导入覆盖。");
  await connect(b.page);
  await sync(b.page);
  assert(
    Object.entries(fixture.files()).some(
      ([path, text]) => path.startsWith("knowledge/citations/") && text.includes("独特引用证据"),
    ),
  );

  if (production) {
    // Warm Studio's dynamically requested runtime chunks under the service worker,
    // then open a fresh document without network or source-module imports.
    await a.page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await a.page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await a.page.reload();
    await saved(a.page);
    const url = a.page.url();
    await a.page.close();
    await a.context.setOffline(true);
    a.page = await a.context.newPage();
    a.page.setDefaultTimeout(25_000);
    await a.page.goto(url);
    await matchesBody(a.page, "# 导入手写笔记\n\n开放格式保持可读。");
    await body(a.page, "关闭页面后仍可离线启动、编辑。");
    await a.page.reload();
    await matchesBody(a.page, "关闭页面后仍可离线启动、编辑。");
    await a.context.setOffline(false);
  }
  assert.deepEqual(errors, []);
  console.log(
    `knowledge ${production ? "production + offline cold boot" : "development"} browser verification PASSED (two devices, merge, conflicts, recovery, search, Markdown, mobile)`,
  );
} catch (error) {
  console.error({
    diagnostics,
    requests: fixture.state.requests.map(({ method, path }) => ({ method, path })),
  });
  await mkdir("scripts/shots", { recursive: true });
  for (const [name, d] of [
    ["a", a],
    ["b", b],
  ])
    if (d && !d.page.isClosed())
      await d.page.screenshot({
        path: `scripts/shots/knowledge-failure-${name}.png`,
        fullPage: true,
      });
  throw error;
} finally {
  await browser.close();
  if (server) await new Promise((done) => server.close(done));
}
