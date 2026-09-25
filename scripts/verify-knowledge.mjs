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
  await page.getByRole("navigation", { name: "笔记列表" }).waitFor();
  return { context, page };
}
// 保存/同步状态只保留 data-testid="knowledge-status" 状态簇：落库后的稳态文案
// 以「已保存/已同步」开头（未配置同步恒为「已保存到本机」）。
const saved = (page) =>
  page
    .locator('[data-testid="knowledge-status"] .knowledge-status-line')
    .filter({ hasText: /^(已保存|已同步)/u })
    .waitFor();
async function openSyncPopover(page) {
  const popover = page.locator(".knowledge-sync-popover");
  if (!(await popover.isVisible())) await page.locator(".knowledge-status-trigger").click();
  await popover.waitFor();
  return popover;
}
async function closeSyncPopover(page) {
  const popover = page.locator(".knowledge-sync-popover");
  if (await popover.isVisible()) {
    await page.keyboard.press("Escape");
    await popover.waitFor({ state: "hidden" });
  }
}
// 同步按钮运行期间会改文案（同步中…/连接并同步中…）并禁用提交；完成信号取
// 「闲置文案回来 + 本轮确实打到了 mock GitHub」，再断言状态行，避免拿上一次
// 同步留下的旧状态交差。
async function runAndWait(page, button, idleText) {
  const before = fixture.state.requests.length;
  await button.click();
  for (let attempt = 0; attempt < 300; attempt++) {
    const label = (await button.textContent())?.trim();
    if (fixture.state.requests.length > before && label === idleText) return;
    await page.waitForTimeout(100);
  }
  throw new Error(`同步操作未在预期时间内完成：${idleText}`);
}
async function connect(page) {
  const popover = await openSyncPopover(page);
  await popover.getByRole("button", { name: "同步设置…", exact: true }).click();
  // SecretField 从不把已存密钥渲染进输入框：已配置时只有「替换密钥」入口。
  const token = page.getByLabel("GitHub Token", { exact: true });
  if (!(await token.count()))
    await page.getByRole("button", { name: "替换密钥", exact: true }).click();
  await page.getByLabel("GitHub 仓库地址").fill("https://github.com/alice/notes");
  await token.fill("secret-browser-token");
  await runAndWait(
    page,
    page.locator("section.knowledge-sync").getByRole("button", { name: /连接并同步/u }),
    "连接并同步",
  );
  // 完成提示是 连接成功，请处理内容冲突。/ 本批已同步… / 已与 GitHub 同步 之一；
  // 冲突场景顶栏状态行也会给出冲突待处理。
  await page.waitForFunction(() => {
    const message =
      document.querySelector("section.knowledge-sync [role='status']")?.textContent ?? "";
    const line = document.querySelector(".knowledge-status-line")?.textContent ?? "";
    return /已与 GitHub 同步|本批已同步|连接成功/u.test(message) || /已同步|冲突待处理/u.test(line);
  });
  assert.equal(await page.locator("section.knowledge-sync [role='alert']").count(), 0);
  await page.getByRole("button", { name: "关闭同步设置", exact: true }).click();
  // 浮层关闭有退场过渡：等它真正隐藏，后续步骤的可见性判断才稳定。
  await page
    .getByRole("button", { name: "关闭同步设置", exact: true })
    .waitFor({ state: "hidden" });
  await closeSyncPopover(page);
}
async function sync(page, conflict = false) {
  const close = page.getByRole("button", { name: "关闭同步设置", exact: true });
  if (await close.isVisible()) {
    await close.click();
    await close.waitFor({ state: "hidden" });
  }
  // 上一次同步的提示还挂着时，同样的提示文本不代表新同步已完成；先清掉旧提示。
  const dismiss = page.getByRole("button", { name: "关闭提示", exact: true });
  if (await dismiss.isVisible()) {
    await dismiss.click();
    await page.locator(".knowledge-notice").waitFor({ state: "hidden" });
  }
  const popover = await openSyncPopover(page);
  await runAndWait(page, popover.getByRole("button", { name: /立即同步|同步中/u }), "立即同步");
  // 同步落定后的顶栏状态行是本轮结果：干净同步为已同步，冲突为 N 处冲突待处理。
  if (conflict)
    await page.locator(".knowledge-status-line").filter({ hasText: "冲突待处理" }).waitFor();
  else await page.locator(".knowledge-status-line").filter({ hasText: "已同步" }).waitFor();
  assert.equal(await page.locator(".knowledge-notice.is-error").count(), 0);
  await closeSyncPopover(page);
}
async function body(page, text) {
  await page.getByLabel("笔记正文", { exact: true }).fill(text);
  await saved(page);
}
// 实时预览装饰是纯呈现层：编辑模式会把标题/链接标记 `Decoration.replace` 掉，
// .cm-line 的渲染文本不等于文档原文。保留 `.cm-line` join 的读法，但在「源码」
// 模式（live 关闭）下读到的才是完整 Markdown（含 #、[[…]] 等标记）。
async function rawBody(page) {
  await page.getByLabel("笔记正文", { exact: true }).waitFor();
  const source = page.getByRole("button", { name: "源码", exact: true });
  const raw = (await source.getAttribute("aria-pressed")) !== "true";
  if (raw) await source.click();
  try {
    return await page.evaluate(() =>
      [...document.querySelectorAll('[aria-label="笔记正文"] .cm-line')]
        .map((line) => line.textContent)
        .join("\n"),
    );
  } finally {
    if (raw) await source.click();
  }
}
async function matchesBody(page, text) {
  // The body is a CodeMirror surface, not a <textarea>. Match its rendered
  // lines rather than a `.value` property that no longer exists: CodeMirror
  // wraps each visual line in its own element, so joining `.cm-line` is the
  // faithful read of the document text (in source mode, see rawBody).
  await page.getByLabel("笔记正文", { exact: true }).waitFor();
  const source = page.getByRole("button", { name: "源码", exact: true });
  const raw = (await source.getAttribute("aria-pressed")) !== "true";
  if (raw) await source.click();
  try {
    await page.waitForFunction(
      (expected) =>
        [...document.querySelectorAll('[aria-label="笔记正文"] .cm-line')]
          .map((line) => line.textContent)
          .join("\n") === expected,
      text,
    );
  } finally {
    if (raw) await source.click();
  }
}
async function retitle(page, text) {
  // 行内重命名是防抖异步的；撤销提示出现代表改名（含链接改写）已经落库。
  await page.getByLabel("笔记标题", { exact: true }).fill(text);
  await page.locator(".knowledge-undo-toast-message").filter({ hasText: "已重命名" }).waitFor();
}
const historyEntry = (page, reason) =>
  page
    .locator("li.knowledge-history-entry")
    .filter({ has: page.locator(".knowledge-history-entry-reason", { hasText: reason }) });
let a, b;
try {
  a = await device();
  b = await device();
  await a.page.goto(`${origin}/knowledge?note=__proto__`);
  await a.page.getByRole("button", { name: "新建笔记", exact: true }).click();
  await a.page.getByLabel("笔记标题", { exact: true }).fill("AI Native 知识系统");
  // 标签入口是安静的「+ 标签」，点击后才出现输入框（提示在 placeholder 里）。
  await a.page.getByRole("button", { name: "添加标签", exact: true }).click();
  await a.page.getByLabel("笔记标签", { exact: true }).pressSequentially("local, markdown");
  // 新的标签输入是 chip 语义：逗号/回车提交，最后一段留在草稿里，回车落库。
  await a.page.getByLabel("笔记标签", { exact: true }).press("Enter");
  await body(a.page, "# 独立手写知识\n\n第一段\n\n第三段\n");
  await a.page.reload();
  await saved(a.page);
  // 标签在新 UI 里是 chip（移除标签 X 按钮），不再回填输入框文本。
  for (const tag of ["local", "markdown"])
    await a.page.getByRole("button", { name: `移除标签 ${tag}`, exact: true }).waitFor();
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

  // 真冲突：标题被双方各自改写（无法自动合并 -> 冲突行），正文改动落在不同行
  // （保守行合并可合并 -> 「合并」可用，双方正文改动都保留）。
  await body(a.page, "# 独立手写知识\n\n设备 A 的冲突段\n\n设备 B 的第三段\n");
  await retitle(a.page, "冲突标题 A");
  await body(b.page, "# 独立手写知识\n\n设备 A 的第一段\n\n设备 B 的冲突段\n");
  await retitle(b.page, "冲突标题 B");
  await sync(a.page);
  await sync(b.page, true);
  await b.page.reload();
  await b.page.getByText("这篇笔记存在同步冲突，双方内容已保留。").waitFor();
  await b.page.getByRole("button", { name: "处理冲突", exact: true }).click();
  assert.equal(await b.page.locator("article.knowledge-conflict-row").count(), 1);
  await b.page.getByText("合并保留本机的标题与路径，正文改动双方保留。").waitFor();
  await b.page.getByRole("button", { name: "合并", exact: true }).click();
  await b.page.getByText("已合并双方正文改动；标题与路径保留本机，远端版本已存入历史").waitFor();
  await b.page.locator("article.knowledge-conflict-row").waitFor({ state: "hidden" });
  await b.page.getByRole("button", { name: "关闭处理冲突", exact: true }).click();
  await b.page
    .getByRole("button", { name: "关闭处理冲突", exact: true })
    .waitFor({ state: "hidden" });
  // SecretField 不回显已存密钥：重载之后只能看到空的 Token 输入框。
  const popover = await openSyncPopover(b.page);
  await popover.getByRole("button", { name: "同步设置…", exact: true }).click();
  assert.equal(await b.page.getByLabel("GitHub Token", { exact: true }).inputValue(), "");
  await b.page.getByLabel("GitHub Token", { exact: true }).fill("secret-browser-token");
  await runAndWait(
    b.page,
    b.page.locator("section.knowledge-sync").getByRole("button", { name: /连接并同步/u }),
    "连接并同步",
  );
  await b.page.getByRole("button", { name: "关闭同步设置", exact: true }).click();
  await b.page
    .getByRole("button", { name: "关闭同步设置", exact: true })
    .waitFor({ state: "hidden" });
  await closeSyncPopover(b.page);
  await sync(b.page);
  await sync(a.page);
  // 合并诚实：两台设备收敛到同一合并正文（双方正文改动都在），本机标题胜出，
  // 且「保留双方」不再制造第二篇笔记。
  const conflictMerged = "# 独立手写知识\n\n设备 A 的冲突段\n\n设备 B 的冲突段\n";
  await matchesBody(b.page, conflictMerged);
  await matchesBody(a.page, conflictMerged);
  assert.equal(await a.page.locator(".knowledge-note-card").count(), 1);
  assert.equal(await b.page.locator(".knowledge-note-card").count(), 1);
  await a.page.locator(".knowledge-note-card").filter({ hasText: "冲突标题 B" }).waitFor();

  await a.page.getByRole("button", { name: "笔记版本历史", exact: true }).click();
  await a.page.getByRole("tab", { name: "GitHub", exact: true }).click();
  await a.page.getByRole("button", { name: "读取 GitHub 历史", exact: true }).click();
  await historyEntry(a.page, "GitHub").last().waitFor();
  await historyEntry(a.page, "GitHub")
    .last()
    .getByRole("button", { name: "恢复", exact: true })
    .click();
  // 恢复是异步落库的，弹窗不自动关；模态会挡住模式切换，先关再断言正文。
  await a.page.getByRole("button", { name: "关闭版本历史", exact: true }).click();
  await a.page
    .getByRole("button", { name: "关闭版本历史", exact: true })
    .waitFor({ state: "hidden" });
  await matchesBody(a.page, "# 独立手写知识\n\n第一段\n\n第三段\n");

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
  await a.page.getByRole("button", { name: "阅读", exact: true }).click();
  await a.page.locator(".knowledge-prose h1").waitFor();
  assert.equal(await a.page.evaluate(() => window.knowledgeXss), undefined);
  assert.equal(externalImages, 0);
  assert.equal(await a.page.locator('.knowledge-prose a[href^="javascript:"]').count(), 0);
  await a.page.getByRole("button", { name: "编辑", exact: true }).click();
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
  await historyEntry(a.page, "删除前版本")
    .first()
    .getByRole("button", { name: "恢复", exact: true })
    .click();
  await a.page.getByRole("button", { name: "关闭版本历史", exact: true }).click();
  await matchesBody(a.page, "# 导入手写笔记\n\n开放格式保持可读。");

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
  // Read the editor's rendered lines, not a textarea `.value` (source mode: raw text).
  const importedBody = await rawBody(b.page);
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
