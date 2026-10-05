/** Fixed HTML → UI state → isolated screenshot → feedback → MCP → version comparison. */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { startRunner } from "../src/server.ts";
import { RunnerClient } from "../src/client.ts";

const origin = new URL(process.env.BCR_BROWSER_URL ?? "http://localhost:5199").origin;
const temp = mkdtempSync(join(tmpdir(), "bcr-page-review-")),
  root = join(temp, "work"),
  token = "page-review-test-".repeat(5);
mkdirSync(root);
const html = (price) =>
  `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#f2eee6;color:#243c32;font-family:system-ui;padding:44px}h1{font-size:46px;letter-spacing:-2px}input{font:inherit;padding:8px}output{font-size:42px;display:block;margin:30px 0}section{height:1400px}button{padding:12px}</style><section><p>EVERYDAY ECONOMICS / 01</p><h1 id="headline">年卡，值得吗？</h1><input id="visits" type="number" value="30"><input id="secret" type="password" value="never-save-me"><output id="cost"></output><details id="details"><summary>假设与来源</summary><p>每次使用的成本，取决于真实出勤次数。</p></details><button id="next">切换情景</button><p id="scenario"></p></section><script>let mode=0;const paint=()=>{document.querySelector('#cost').textContent=${price}/Number(document.querySelector('#visits').value);document.querySelector('#scenario').textContent='情景 '+mode};document.querySelector('#visits').oninput=paint;document.querySelector('#next').onclick=()=>{mode++;paint()};window.bcrReview={exportState:()=>({mode}),importState:s=>{mode=s.mode;paint()}};paint();</script>`;
writeFileSync(
  join(root, "work.json"),
  JSON.stringify({
    format: "bcr-project-1",
    id: "page-review",
    title: "页面审阅样例",
    targets: [{ id: "page", runtime: "html", entry: "index.html" }],
  }),
);
writeFileSync(join(root, "index.html"), html(1800));
writeFileSync(join(root, "sources.html"), '<h1 id="sources">资料来源</h1><p>价格为演示假设</p>');
process.env.BCR_RUNNER_BROWSER = chromium.executablePath();
const runner = startRunner({ root, state: join(temp, "state"), origin, token, port: 0 });
const connection = { url: runner.url, token },
  api = new RunnerClient(connection);
const config = join(temp, "connection.json");
writeFileSync(config, JSON.stringify(connection), { mode: 0o600 });
let browser, mcp;
const wait = async (fn, message) => {
  for (let i = 0; i < 160; i++) {
    const value = await fn();
    if (value) return value;
    await Bun.sleep(200);
  }
  throw new Error(message);
};
const produce = async (revision) => {
  const job = runner.jobs.start({
    id: "page-review",
    revision,
    target: "page",
    kind: "preview",
    requestId: crypto.randomUUID(),
  });
  return wait(() => {
    const j = runner.jobs.get(job.id);
    if (j.status === "failed") throw new Error(j.error);
    return j.status === "succeeded" && j;
  }, "preview timeout");
};
const edit = (action) =>
  runner.service.review.edit({
    id: "page-review",
    revision: runner.service.review.read("page-review").revision,
    requestId: crypto.randomUUID(),
    action,
  });
const connect = async (page) => {
  await page.getByRole("button", { name: "连接本地工程", exact: true }).first().click();
  await page.getByLabel("Runner 地址").fill(connection.url);
  await page.getByLabel("配对密钥").fill(token);
  await page.getByRole("button", { name: "连接", exact: true }).click();
  await page.getByRole("button", { name: "本地已连接", exact: true }).waitFor();
};
try {
  const first = runner.projects.read("page-review");
  await produce(first.revision);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${origin}/works`, { waitUntil: "networkidle" });
  await connect(page);
  await page.getByLabel("选择作品").selectOption(`${first.ref.sourceId}:page-review`);
  await page.getByRole("button", { name: "提交第一个版本", exact: true }).click();
  await page.getByLabel("审阅版本名称").fill("页面初稿");
  await page.getByLabel("修改说明").fill("审阅页面布局与不同使用次数的成本");
  await page.getByRole("dialog").getByLabel("sources.html", { exact: true }).check();
  await page.getByRole("dialog").getByRole("button", { name: "提交审阅", exact: true }).click();
  let frame = page.locator(".review-page iframe").contentFrame();
  await frame.locator("#headline").waitFor();
  assert.equal(await frame.locator("body").evaluate(() => innerWidth), 1280);
  await page.getByLabel("页面初稿 页面", { exact: true }).selectOption("sources.html");
  await frame.locator("#sources").waitFor();
  await page.getByLabel("页面初稿 页面", { exact: true }).selectOption("index.html");
  await frame.locator("#visits").fill("60");
  await frame.locator("#next").click();
  await frame.locator("#details").evaluate((e) => (e.open = true));
  await frame.locator("body").evaluate(() => scrollTo(0, 100));
  await page.getByRole("button", { name: "保存视图", exact: true }).click();
  const v1 = await wait(() => runner.service.review.read("page-review").views?.[0], "view timeout");
  assert.equal(v1.page.scroll.y, 100);
  assert.equal(v1.page.viewport.width, 1280);
  assert(v1.page.controls.some((c) => c.value === "60"));
  assert(!JSON.stringify(v1).includes("never-save-me"));
  assert.equal(JSON.parse(v1.page.custom).mode, 1);
  assert(v1.page.details[0].open);
  const png = runner.service.captures.image(v1.image.captureId);
  assert.equal(png.readUInt32BE(16), 1280);
  assert.equal(png.readUInt32BE(20), 800);
  assert(v1.elements.some((e) => e.text === "30"));
  assert(v1.elements.some((e) => e.text === "情景 1"));
  await page.getByRole("img", { name: `${v1.title} 固定截图`, exact: true }).waitFor();
  await page.getByRole("button", { name: "定位当前画面", exact: true }).click();
  await page
    .getByRole("button", { name: "在画面上定位反馈", exact: true })
    .click({ position: { x: 80, y: 80 } });
  await page.getByLabel("审阅反馈").fill("请将年卡价格更新为 2400，保留版式。");
  await page.getByRole("button", { name: "保存反馈", exact: true }).click();
  const feedback = await wait(
    () => runner.service.review.read("page-review").feedback[0],
    "feedback timeout",
  );
  assert.equal(feedback.anchor.viewId, v1.id);
  await page.getByRole("button", { name: "恢复交互", exact: true }).click();
  await frame.locator("#scenario").getByText("情景 1", { exact: true }).waitFor();
  assert.equal(await frame.locator("#visits").inputValue(), "60");
  await wait(() => frame.locator("body").evaluate(() => scrollY === 100), "restored scroll");
  await page.getByLabel("页面初稿 视口", { exact: true }).selectOption("390x844");
  await wait(() => frame.locator("body").evaluate(() => innerWidth === 390), "mobile viewport");
  await page.getByLabel("页面初稿 视口", { exact: true }).selectOption("1280x800");
  console.log(
    "PASS: multi-page selection, fixed viewport, state replay, screenshot and anchored feedback",
  );
  mcp = new Client(
    { name: "page-review-test", version: "1.0.0" },
    { versionNegotiation: { mode: "legacy" } },
  );
  await mcp.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [resolve("apps/work-runner/src/cli.ts"), "mcp", "--config", config],
    }),
  );
  const call = async (op, input) => {
    const r = await mcp.callTool({ name: `runner_${op}`, arguments: input });
    assert(!r.isError, JSON.stringify(r));
    return r;
  };
  assert(
    (await call("page_image", { id: v1.image.captureId })).content.some((c) => c.type === "image"),
  );
  writeFileSync(join(root, "index.html"), html(2400));
  const second = runner.projects.read("page-review"),
    preview = await produce(second.revision);
  edit({
    kind: "submit",
    submissionId: "second",
    sourceRevision: second.revision,
    target: "page",
    title: "价格修订",
    summary: "修正年卡价格",
    addresses: [feedback.id],
    jobIds: [preview.id],
  });
  const request = {
    requestId: "capture-second",
    source: { kind: "submission", id: "page-review", submissionId: "second" },
    page: v1.page,
  };
  const captured = JSON.parse((await call("page_capture", request)).content[0].text);
  assert(captured.elements.some((e) => e.text === "40"));
  assert.deepEqual(await api.call("page_capture", request), captured);
  await assert.rejects(
    api.call("page_capture", {
      ...request,
      page: { ...v1.page, viewport: { width: 768, height: 1024 } },
    }),
    /requestId/,
  );
  const view = {
    id: captured.id,
    submissionId: "second",
    title: "同一状态",
    page: captured.page,
    image: captured.image,
    elements: captured.elements,
    warnings: captured.warnings,
    engine: captured.engine,
    createdAt: captured.createdAt,
  };
  edit({ kind: "view", view });
  assert.throws(
    () => edit({ kind: "view", view: { ...view, id: "forged", submissionId: v1.submissionId } }),
    /不属于/,
  );
  assert.throws(
    () =>
      edit({
        kind: "comment",
        feedbackId: "wrong-view",
        submissionId: v1.submissionId,
        comment: "wrong",
        anchor: { viewId: view.id },
      }),
    /不属于/,
  );
  await page.getByLabel("审阅版本", { exact: true }).selectOption("second");
  await frame.locator("#cost").getByText("80", { exact: true }).waitFor();
  await page.getByRole("button", { name: "比较版本", exact: true }).click();
  await page.getByRole("button", { name: "比较截图", exact: true }).click();
  await page.getByRole("dialog").getByLabel("截图比较方式").selectOption("difference");
  await page.screenshot({ path: "/tmp/bcr-page-compare.png", fullPage: true });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "关闭对比", exact: true }).click();
  await page.screenshot({ path: "/tmp/bcr-page-review.png", fullPage: true });
  const old = await api.call("page_capture", {
    ...request,
    requestId: "old-again",
    source: { kind: "submission", id: "page-review", submissionId: v1.submissionId },
  });
  assert(old.elements.some((e) => e.text === "30"));
  console.log(
    "PASS: MCP image feedback, idempotence, source binding, immutable old page and visual comparison",
  );

  // Browser work uses the same UI and state contract, storing compiled pages and PNGs in OPFS.
  const work = await page.evaluate(
    async ({ html, opfsModule }) => {
      const { WorkStore } = await import("/src/works/store.ts");
      const { WorkspaceFiles } = await import("/src/workspace/files.ts");
      const { createWorkspaceStorage } = await import("/src/workspace/storage.ts");
      const { OpfsStore } = await import(opfsModule);
      const storage = createWorkspaceStorage("bcr-works"),
        files = new WorkspaceFiles(new OpfsStore("studio")),
        store = new WorkStore(storage, files);
      const w = await store.commit({
        requestId: crypto.randomUUID(),
        revision: null,
        title: "浏览器页面",
        entry: "index.html",
        put: [
          { path: "index.html", text: html },
          { path: "sources.html", text: "<h1>浏览器资料</h1>" },
        ],
      });
      await store.reviewEdit({
        id: w.id,
        revision: "initial",
        requestId: crypto.randomUUID(),
        action: {
          kind: "submit",
          submissionId: "browser-first",
          sourceRevision: w.revision,
          target: "page",
          title: "浏览器首稿",
          summary: "固定页面",
          addresses: [],
          pages: [
            { path: "index.html", title: "首页" },
            { path: "sources.html", title: "来源" },
          ],
        },
      });
      await store.commit({
        id: w.id,
        revision: w.revision,
        requestId: crypto.randomUUID(),
        put: [{ path: "index.html", text: "<h1>Later source must not appear in review</h1>" }],
      });
      await store.close();
      await storage.close();
      return w;
    },
    { html: html(1800), opfsModule: `/@fs${resolve("packages/storage-opfs/src/index.ts")}` },
  );
  await page.goto(`${origin}/works?source=browser&work=${work.id}`, { waitUntil: "networkidle" });
  await connect(page);
  await page
    .locator(".review-page iframe")
    .contentFrame()
    .locator("#cost")
    .getByText("60", { exact: true })
    .waitFor();
  await page.getByLabel("浏览器首稿 页面", { exact: true }).selectOption("sources.html");
  await page
    .locator(".review-page iframe")
    .contentFrame()
    .getByText("浏览器资料", { exact: true })
    .waitFor();
  await page.getByLabel("浏览器首稿 页面", { exact: true }).selectOption("index.html");
  await page.locator(".review-page iframe").contentFrame().locator("#visits").fill("90");
  await page.getByRole("button", { name: "保存视图", exact: true }).click();
  await page.getByRole("button", { name: "恢复交互", exact: true }).waitFor();
  await page.reload({ waitUntil: "networkidle" }); // No Runner connection: persisted browser screenshots remain readable.
  await page.getByLabel("浏览器首稿 已保存视图").getByRole("button").first().click();
  await page.locator(".review-page-image").evaluate((image) => image.decode());
  assert(
    !(await page.getByText("Later source must not appear in review", { exact: true }).count()),
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: browser submission reuses fixed HTML, multi-page review and OPFS screenshot survive reload without Runner",
  );
  const isolated = await api.call("page_capture", {
    requestId: "blocked-network",
    source: {
      kind: "document",
      key: "isolated",
      html: `<h1>Isolated</h1><img src="http://127.0.0.1:${runner.api.port}/health"><script>fetch('https://example.com').catch(()=>{})</script>`,
    },
    page: { path: "index.html", viewport: { width: 390, height: 844 }, custom: '{"mode":1}' },
  });
  assert(isolated.warnings.some((w) => w.includes("外部资源")));
  assert(isolated.warnings.some((w) => w.includes("importState")));
  assert.equal((await fetch(`${runner.url}/captures/${isolated.id}`)).status, 401);
  await assert.rejects(
    api.call("page_capture", {
      ...request,
      requestId: "wrong-path",
      page: { ...v1.page, path: "../connection.json" },
    }),
    /不在/,
  );
  const fixedSite = join(runner.jobs.directory(preview.id), "site", "index.html");
  writeFileSync(fixedSite, "<h1>Tampered immutable page</h1>");
  await assert.rejects(
    api.call("page_capture", { ...request, requestId: "tampered" }),
    /ERR_FAILED|固定|校验/,
  );
  await assert.rejects(
    api.call("page_capture", {
      requestId: "loop",
      source: { kind: "document", key: "loop", html: "<script>while(true){}</script>" },
      page: { path: "index.html", viewport: { width: 390, height: 844 } },
    }),
    /Timeout|timeout|超过/,
  );
  console.log(
    "PASS: authenticated images, denied network, invalid page/source rejection, integrity checks and bounded worker execution",
  );
} finally {
  await mcp?.close();
  await browser?.close();
  await runner.close();
  rmSync(temp, { recursive: true, force: true });
}
