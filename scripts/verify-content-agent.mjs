import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { launchEphemeralBrowser, collectPageErrors, ensureShots } from "./lib/browser.mjs";

const require = createRequire(new URL("../apps/studio/package.json", import.meta.url));
const { ZipReader, BlobReader, Uint8ArrayWriter } = require("@zip.js/zip.js");
const origin = new URL(process.env.BASE_URL ?? "http://localhost:5199").origin;
const browser = await launchEphemeralBrowser({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage(),
  errors = collectPageErrors(page),
  shots = ensureShots();
page.setDefaultTimeout(30000);
await page.emulateMedia({ reducedMotion: "reduce" });
let queue = [],
  completed = 0,
  sequence = 0,
  saved,
  read,
  releaseId,
  exported;
await page.route("**/api/content-test/v1/chat/completions", async (route) => {
  const request = route.request().postDataJSON();
  for (const name of [
    "content_catalog",
    "content_create",
    "content_read",
    "content_apply",
    "content_evaluate",
    "content_release",
    "content_export",
    "content_restore",
    "content_import",
    "content_file",
  ])
    assert(
      request.tools.some((t) => t.function.name === name),
      `registered ${name}`,
    );
  const last = request.messages.at(-1);
  if (last?.role === "tool") {
    const result = JSON.parse(last.content);
    if (result.status === "saved") saved = result;
    if (result.item) read = result;
    if (result.releaseId) releaseId = result.releaseId;
    if (result.artifact) exported = result;
    assert(!result.error, JSON.stringify(result));
  }
  const next = queue.shift();
  const delta = next
    ? {
        role: "assistant",
        tool_calls: [
          {
            index: 0,
            id: `content-${++sequence}`,
            type: "function",
            function: {
              name: `content_${next.name}`,
              arguments: JSON.stringify(typeof next.args === "function" ? next.args() : next.args),
            },
          },
        ],
      }
    : { role: "assistant", content: `创作操作完成 ${++completed}` };
  await route.fulfill({
    contentType: "text/event-stream",
    body: `data: ${JSON.stringify({ id: "content-test", model: "fake", choices: [{ delta, finish_reason: next ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`,
  });
});
const panel = page.getByRole("dialog", { name: "AI 助手", exact: true });
const approval = panel.getByRole("group", { name: "待确认的操作" });
async function send(steps, approvals = 0) {
  queue = steps;
  const next = completed + 1;
  const input = panel.getByPlaceholder("提问、整理思路，或请我处理当前内容…");
  await input.fill(`验证创作流程 ${next}`);
  await input.press("Enter");
  for (let i = 0; i < approvals; i++) {
    await approval.waitFor();
    await approval.getByRole("button", { name: "应用修改", exact: true }).click();
  }
  await panel.getByText(`创作操作完成 ${next}`, { exact: true }).waitFor({ timeout: 90000 });
}
const close = async () => {
  await panel.getByRole("button", { name: "关闭 AI 助手", exact: true }).click();
  await panel.waitFor({ state: "hidden" });
};
const tab = (name, p = page) =>
  p
    .getByRole("navigation", { name: "内容创作流程" })
    .getByRole("button", { name: new RegExp(name) })
    .click();
async function zipFiles(path) {
  const zip = new ZipReader(new BlobReader(new Blob([await readFile(path)]))),
    files = new Map();
  try {
    for (const entry of await zip.getEntries())
      files.set(entry.filename, Buffer.from(await entry.getData(new Uint8ArrayWriter())));
  } finally {
    await zip.close();
  }
  return files;
}
try {
  await page.goto(`${origin}/content`);
  await page.getByRole("button", { name: "AI 创作", exact: true }).click();
  await panel.getByRole("button", { name: "接口", exact: true }).click();
  await panel.getByLabel("AI 接口地址").fill(`${origin}/api/content-test/v1`);
  await panel.getByLabel("AI 模型名称").fill("fake-model");
  await panel.getByRole("button", { name: "保存连接", exact: true }).click();
  await panel.getByRole("button", { name: "← 返回对话", exact: true }).click();
  await send(
    [
      { name: "catalog", args: { preset: "cooking" } },
      {
        name: "create",
        args: { requestId: "browser-create-cooking", preset: "cooking", title: "AI 午餐研究" },
      },
    ],
    1,
  );
  assert(saved?.id);
  await panel.getByRole("button", { name: "AI 午餐研究 ↗", exact: true }).last().click();
  await close();
  await tab("页面");
  await page.getByLabel("损耗率", { exact: true }).fill("0.4");
  await page.getByText("编辑页面文字", { exact: true }).click();
  await page
    .getByLabel("正文 · intro", { exact: true })
    .fill("手工保留的解释：时间和现金分别展示。");
  await page.getByRole("button", { name: "保存页面与参数", exact: true }).click();
  await page.getByText("已保存 · 可通过助手继续编辑", { exact: true }).waitFor();
  assert.match(await page.locator(".page-table").innerText(), /20\.00/u);
  await page.getByRole("button", { name: "AI 创作", exact: true }).click();
  await send(
    [
      { name: "read", args: () => ({ id: saved.id }) },
      {
        name: "apply",
        args: () => ({
          id: read.id,
          revision: read.revision,
          requestId: "browser-heading",
          changes: {
            pagePatches: [
              {
                id: "main",
                upsert: {
                  heading: { type: "Heading", props: { text: "午餐，现金与时间的取舍", level: 1 } },
                },
              },
            ],
          },
        }),
      },
    ],
    1,
  );
  await close();
  await page.getByRole("heading", { name: "午餐，现金与时间的取舍", exact: true }).waitFor();
  assert(
    await page
      .locator(".content-page")
      .getByText("手工保留的解释：时间和现金分别展示。", { exact: true })
      .isVisible(),
  );
  await page.locator(".content-main").evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.screenshot({ path: `${shots}/content-generated-page.png`, fullPage: true });
  await page.getByRole("button", { name: "AI 创作", exact: true }).click();
  await send(
    [
      { name: "read", args: () => ({ id: saved.id }) },
      {
        name: "release",
        args: () => ({
          id: read.id,
          revision: read.revision,
          requestId: "browser-release",
          noteRevision: read.noteRevision,
        }),
      },
    ],
    1,
  );
  assert(releaseId);
  await send(
    [
      {
        name: "export",
        args: () => ({ id: saved.id, revision: saved.revision, kind: "publication", releaseId }),
      },
    ],
    1,
  );
  assert(exported?.artifact?.hash);
  let download = page.waitForEvent("download");
  await panel.getByRole("button", { name: "下载文件", exact: true }).last().click();
  await (await download).saveAs(`${shots}/content-ai-publication.zip`);
  const files = await zipFiles(`${shots}/content-ai-publication.zip`);
  for (const name of [
    "pages/main.svg",
    "pages/main.png",
    "pages/main.html",
    "pages/main.json",
    "analysis.json",
  ])
    assert(files.has(name), name);
  assert.match(files.get("pages/main.svg").toString(), /手工保留的解释/u);
  assert.equal(files.get("pages/main.png").readUInt32BE(0), 0x89504e47);
  await send(
    [{ name: "export", args: () => ({ id: saved.id, revision: saved.revision, kind: "archive" }) }],
    1,
  );
  download = page.waitForEvent("download");
  await panel.getByRole("button", { name: "下载文件", exact: true }).last().click();
  await (await download).saveAs(`${shots}/content-ai-archive.zip`);
  await close();
  await page.setViewportSize({ width: 390, height: 844 });
  await tab("页面");
  assert(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    "mobile page fits viewport",
  );
  assert(
    await page.locator(".content-main").evaluate((el) => el.scrollWidth <= el.clientWidth),
    "page controls fit mobile content width",
  );
  await page.screenshot({ path: `${shots}/content-generated-mobile.png`, fullPage: true });

  const fresh = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
    restored = await fresh.newPage();
  const restoreErrors = collectPageErrors(restored);
  await restored.goto(`${origin}/content`);
  await restored.getByLabel("选择内容项目归档").setInputFiles(`${shots}/content-ai-archive.zip`);
  await restored.getByRole("button", { name: "恢复项目", exact: true }).click();
  await tab("页面", restored);
  await restored.getByRole("heading", { name: "午餐，现金与时间的取舍", exact: true }).waitFor();
  await tab("发布与归档", restored);
  download = restored.waitForEvent("download", { timeout: 90000 });
  await restored.getByRole("button", { name: "下载发布包", exact: true }).click();
  await (await download).saveAs(`${shots}/content-ai-restored.zip`);
  const regenerated = await zipFiles(`${shots}/content-ai-restored.zip`);
  for (const name of [
    "pages/main.svg",
    "pages/main.png",
    "pages/main.html",
    "pages/main.json",
    "analysis.json",
  ])
    assert(files.get(name).equals(regenerated.get(name)), `reproduced ${name}`);
  assert.deepEqual(errors, []);
  assert.deepEqual(restoreErrors, []);
  await fresh.close();
  console.log(
    "content-agent PASSED: real assistant tools/approval, generated page, parameter calculation, manual edits retained, durable downloads, mobile layout, fresh-context archive and identical regeneration",
  );
} catch (error) {
  console.error("Page errors:", errors);
  console.error("Visible body:", (await page.locator("body").innerText()).slice(-6000));
  await page
    .screenshot({ path: `${shots}/content-agent-failure.png`, fullPage: true })
    .catch(() => {});
  throw error;
} finally {
  await context.close();
  await browser.close();
}
