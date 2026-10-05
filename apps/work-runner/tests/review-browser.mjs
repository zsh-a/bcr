/** Real review loop: browser feedback → STDIO MCP revision → compare → fixed ZIP delivery. */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { startRunner } from "../src/server.ts";

const requireStudio = createRequire(new URL("../../studio/package.json", import.meta.url));
const { BlobReader, TextWriter, ZipReader } = await import(requireStudio.resolve("@zip.js/zip.js"));

const origin = new URL(process.env.BCR_BROWSER_URL ?? "http://localhost:5199").origin;
const temp = mkdtempSync(join(tmpdir(), "bcr-review-browser-"));
const root = join(temp, "work"),
  token = "review-browser-test-".repeat(5);
mkdirSync(root);
writeFileSync(
  join(root, "work.json"),
  JSON.stringify({
    format: "bcr-project-1",
    id: "review-film",
    title: "年卡，值得吗？",
    targets: [
      {
        id: "vertical",
        runtime: "remotion",
        entry: "Scene.tsx",
        width: 480,
        height: 640,
        fps: 30,
        durationInFrames: 90,
      },
    ],
  }),
);
const scene = (price) => `import React from 'react';
import {AbsoluteFill, useCurrentFrame, interpolate} from 'remotion';
export default function Scene(){const frame=useCurrentFrame();return <AbsoluteFill style={{background:'#eeeae1',color:'#1d342c',fontFamily:'sans-serif',padding:42,justifyContent:'space-between'}}>
<div style={{fontSize:14,letterSpacing:3}}>EVERYDAY ECONOMICS / 01</div>
<div><div style={{fontSize:27}}>年卡，值得吗？</div><div style={{fontSize:100,fontWeight:700,letterSpacing:-5,marginTop:26}}>${price}<span style={{fontSize:22,letterSpacing:0}}> / 年</span></div>
<div style={{marginTop:26,height:5,background:'#d4d7cb'}}><div style={{height:5,width:interpolate(frame,[0,89],[10,100])+'%',background:'#316952'}}/></div></div>
<div style={{fontSize:17,lineHeight:1.7}}>从使用次数开始，<br/>看见每一次选择的成本。</div></AbsoluteFill>}`;
writeFileSync(join(root, "Scene.tsx"), scene(1680));
process.env.BCR_RUNNER_BROWSER = chromium.executablePath();
const runner = startRunner({ root, state: join(temp, "state"), origin, token, port: 0 });
const url = `http://127.0.0.1:${runner.api.port}`;
const config = join(temp, "connection.json");
writeFileSync(config, JSON.stringify({ url, token }), { mode: 0o600 });
let browser, client;
const waitJob = async (id) => {
  for (let n = 0; n < 600; n++) {
    const job = runner.jobs.get(id);
    if (job.status === "succeeded") return job;
    if (["failed", "cancelled", "interrupted"].includes(job.status))
      throw new Error(JSON.stringify(job));
    await Bun.sleep(200);
  }
  throw new Error(`Job timeout: ${id}`);
};
const produce = async (revision, kind, more = {}) =>
  waitJob(
    runner.jobs.start({
      id: "review-film",
      revision,
      target: "vertical",
      requestId: crypto.randomUUID(),
      kind,
      ...more,
    }).id,
  );
const unzip = async (download) => {
  const reader = new ZipReader(new BlobReader(new Blob([readFileSync(await download.path())])));
  const entries = await reader.getEntries();
  const manifest = JSON.parse(
    await entries.find((e) => e.filename === "delivery.json").getData(new TextWriter()),
  );
  return { reader, entries, manifest };
};
try {
  const first = runner.projects.read("review-film");
  const capture = await produce(first.revision, "capture", { frames: [30] });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${origin}/works`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "连接本地工程", exact: true }).first().click();
  await page.getByLabel("Runner 地址").fill(url);
  await page.getByLabel("配对密钥").fill(token);
  await page.getByRole("button", { name: "连接", exact: true }).click();
  await page.getByRole("button", { name: "本地已连接", exact: true }).waitFor();
  await page.getByLabel("选择作品").selectOption(`${first.ref.sourceId}:review-film`);
  await page.getByRole("button", { name: "提交第一个版本", exact: true }).click();
  await page.getByLabel("审阅版本名称").fill("初稿");
  await page.getByLabel("修改说明").fill("先看数字的层级，再看叙事节奏。");
  await page.getByRole("dialog").getByRole("button", { name: "提交审阅", exact: true }).click();
  const initialImage = page.getByRole("img", { name: "初稿 frame-30.png" });
  await initialImage.evaluate((image) => image.decode());
  await page.getByLabel("审阅反馈").fill("请将年卡价格更新为 1800 元，保留画面风格。");
  await page.getByRole("button", { name: "定位当前画面", exact: true }).click();
  const pin = page.getByRole("button", { name: "在画面上定位反馈" });
  await pin.click({ position: { x: 80, y: 100 } });
  await page.getByLabel("反馈结束帧").fill("45");
  await page.getByRole("button", { name: "保存反馈", exact: true }).click();
  await page.getByText("待修改", { exact: true }).waitFor();
  const feedback = runner.service.review.read("review-film").feedback[0];
  assert.equal(feedback.anchor.frame, 30);
  assert.equal(feedback.anchor.endFrame, 45);
  assert(feedback.anchor.point.x > 0 && feedback.anchor.point.x < 1);
  assert.equal(runner.projects.read("review-film").revision, first.revision);
  await page.getByRole("button", { name: "整理给 Agent", exact: true }).click();
  assert((await page.getByLabel("Agent 修改请求").inputValue()).includes(feedback.id));
  await page.keyboard.press("Escape");
  await page.screenshot({ path: "/tmp/bcr-review-feedback.png", fullPage: true });
  console.log("PASS: pinned keyframe, time range, spatial feedback and Agent handoff");

  client = new Client(
    { name: "review-browser-test", version: "1.0.0" },
    { versionNegotiation: { mode: "legacy" } },
  );
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [resolve("apps/work-runner/src/cli.ts"), "mcp", "--config", config],
    }),
  );
  assert((await client.listTools()).tools.some((t) => t.name === "runner_review_edit"));
  const call = async (op, input = {}) => {
    const reply = await client.callTool({ name: `runner_${op}`, arguments: input });
    assert(!reply.isError, JSON.stringify(reply));
    return JSON.parse(reply.content[0].text);
  };
  await call("checkpoint", {
    id: "review-film",
    revision: first.revision,
    requestId: "first-checkpoint",
    message: "首稿",
  });
  const sourceHistory = await call("versions", { id: "review-film" });
  assert.equal(sourceHistory.items[0].message, "首稿");
  const before = await call("review_read", { id: "review-film" });
  assert.equal(before.feedback[0].id, feedback.id);
  writeFileSync(join(root, "Scene.tsx"), scene(1800));
  const next = await call("read", { id: "review-film" });
  const sourceDiff = await call("diff", {
    id: "review-film",
    from: first.revision,
    to: next.revision,
    path: "Scene.tsx",
  });
  assert(sourceDiff.detail.before.includes(">1680") && sourceDiff.detail.after.includes(">1800"));
  const nextCapture = await produce(next.revision, "capture", { frames: [30] });
  const video = await produce(next.revision, "video", { from: 15, to: 74, profile: "draft" });
  const after = await call("review_edit", {
    id: "review-film",
    revision: before.revision,
    requestId: crypto.randomUUID(),
    action: {
      kind: "submit",
      submissionId: "second",
      sourceRevision: next.revision,
      target: "vertical",
      title: "价格修订",
      summary: "年卡价格更新为 1800 元，保留原有配色和动画。",
      jobIds: [nextCapture.id, video.id],
      addresses: [feedback.id],
    },
  });
  assert.equal(after.feedback[0].status, "addressed");
  await page.getByText("待复核", { exact: true }).waitFor();
  await page.getByRole("button", { name: /价格修订 已回应/ }).click();
  await page.getByLabel("价格修订 视频").evaluate(
    (v) =>
      new Promise((resolve, reject) => {
        if (v.readyState >= 1) return resolve();
        v.onloadedmetadata = resolve;
        v.onerror = reject;
      }),
  );
  assert.equal(await page.locator(".review-stage").count(), 2);
  await page.getByLabel("价格修订 查看内容").selectOption(`${nextCapture.id}/frame-30.png`);
  await page.getByRole("img", { name: "价格修订 frame-30.png" }).evaluate((img) => img.decode());
  await page.screenshot({ path: "/tmp/bcr-review-compare.png", fullPage: true });
  await page.getByRole("button", { name: "确认解决", exact: true }).click();
  await page.getByText("已确认", { exact: true }).waitFor();
  await page.getByRole("button", { name: "定稿交付", exact: true }).click();
  await page.getByLabel("交付名称").fill("年卡 · 发布版");
  await page.getByRole("button", { name: "固定交付清单", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载交付包", exact: true }).click();
  const zip = await unzip(await download);
  assert(zip.entries.some((e) => e.filename.endsWith("video.mp4")));
  assert(zip.entries.some((e) => e.filename.endsWith("frame-30.png")));
  assert.equal(zip.manifest.selections[0].sourceRevision, next.revision);
  await zip.reader.close();
  const fixed = runner.service.review.read("review-film").deliveries[0];
  const sourceRestore = await call("restore", {
    id: "review-film",
    revision: next.revision,
    restoreRevision: first.revision,
    requestId: "restore-first",
  });
  assert.equal(sourceRestore.revision, first.revision);
  assert.deepEqual(runner.service.review.read("review-film").deliveries[0], fixed);

  writeFileSync(join(root, "Scene.tsx"), scene(1900));
  assert.deepEqual(runner.service.review.read("review-film").deliveries[0], fixed);
  assert.equal(runner.jobs.get(capture.id).outputs[0].hash, before.submissions[0].outputs[0].hash);
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: "/tmp/bcr-review-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "下载交付包", exact: true }).scrollIntoViewIfNeeded();
  const mobileDelivery = await page
    .getByRole("button", { name: "下载交付包", exact: true })
    .boundingBox();
  assert(mobileDelivery.y >= 0 && mobileDelivery.y + mobileDelivery.height <= 844);
  await page.screenshot({ path: "/tmp/bcr-review-mobile-delivery.png", fullPage: true });
  console.log(
    "PASS: real MCP submission, comparison, explicit acceptance, MP4/PNG ZIP, immutable delivery and mobile layout",
  );

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "新建页面", exact: true }).click();
  const html = (heading) =>
    `<!doctype html><html><style>body{margin:0;padding:60px;background:#eae8df;color:#243e34;font:18px/1.8 sans-serif}h1{font-size:44px;font-weight:500}small{letter-spacing:4px}</style><body><small>NOTES ON EVERYDAY LIFE</small><h1>${heading}</h1><p>让选择更清晰。</p><button>查看计算</button></body></html>`;
  const makePage = async (text) => {
    await page.getByLabel("作品文件内容").fill(html(text));
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.getByRole("button", { name: "← 返回审阅", exact: true }).click();
  };
  await makePage("一次选择，一种生活");
  await page.getByRole("button", { name: "提交第一个版本", exact: true }).click();
  await page.getByLabel("审阅版本名称").fill("页面初稿");
  await page.getByLabel("修改说明").fill("检查标题和信息层级。");
  await page.getByRole("dialog").getByRole("button", { name: "提交审阅", exact: true }).click();
  await page.locator(".review-stage iframe").waitFor();
  await page
    .frameLocator(".review-stage iframe")
    .getByRole("heading", { name: "一次选择，一种生活" })
    .waitFor();
  await page.getByLabel("审阅反馈").fill("标题要更贴近具体的生活选择。");
  await page.getByRole("button", { name: "定位当前画面", exact: true }).click();
  await page
    .getByRole("button", { name: "在画面上定位反馈" })
    .click({ position: { x: 160, y: 170 } });
  await page.getByRole("button", { name: "保存反馈", exact: true }).click();
  await page.getByText("待修改", { exact: true }).waitFor();
  await page.getByRole("button", { name: "制作与参数", exact: true }).click();
  await makePage("做饭，还是点外卖？");
  await page.getByRole("button", { name: "提交审阅", exact: true }).click();
  await page.getByLabel("审阅版本名称").fill("页面修订");
  await page.getByLabel("修改说明").fill("将抽象标题替换为具体问题。");
  await page
    .getByRole("dialog")
    .getByRole("checkbox", { name: "标题要更贴近具体的生活选择。" })
    .check();
  await page.getByRole("dialog").getByRole("button", { name: "提交审阅", exact: true }).click();
  await page.getByRole("button", { name: "比较版本", exact: true }).click();
  await page
    .getByLabel("页面初稿 画面")
    .frameLocator("iframe")
    .getByRole("heading", { name: "一次选择，一种生活" })
    .waitFor();
  await page
    .getByLabel("页面修订 画面")
    .frameLocator("iframe")
    .getByRole("heading", { name: "做饭，还是点外卖？" })
    .waitFor();
  await page.screenshot({ path: "/tmp/bcr-review-pages.png", fullPage: true });
  await page.getByRole("button", { name: "确认解决", exact: true }).click();
  await page.getByText("已确认", { exact: true }).waitFor();
  await page.getByRole("button", { name: "定稿交付", exact: true }).click();
  await page.getByRole("button", { name: "固定交付清单", exact: true }).click();
  const pageDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载交付包", exact: true }).click();
  const pageZip = await unzip(await pageDownload);
  assert(
    (
      await pageZip.entries.find((e) => e.filename.endsWith("index.html")).getData(new TextWriter())
    ).includes("做饭，还是点外卖？"),
  );
  await pageZip.reader.close();
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("已确认", { exact: true }).waitFor();
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log(
    "PASS: browser page snapshots, two sandbox previews, feedback, portable HTML delivery and reload persistence",
  );
} catch (e) {
  const page = browser?.contexts()[0]?.pages()[0];
  await page?.screenshot({ path: "/tmp/bcr-review-failure.png", fullPage: true });
  writeFileSync(
    "/tmp/bcr-review-failure.txt",
    (await page?.locator("body").innerText()) ?? "no browser",
  );
  throw e;
} finally {
  await client?.close();
  await browser?.close();
  await runner.close();
  rmSync(temp, { recursive: true, force: true });
}
