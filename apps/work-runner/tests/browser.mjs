import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { startRunner } from "../src/server.ts";

const origin = new URL(
  process.env.BCR_BROWSER_URL ?? process.env.BASE_URL ?? "http://localhost:5199",
).origin;
const temp = mkdtempSync(join(tmpdir(), "bcr-runner-browser-"));
const root = join(temp, "project");
cpSync(resolve("apps/work-runner/starter"), root, { recursive: true });
process.env.BCR_RUNNER_BROWSER = chromium.executablePath();
const runner = startRunner({
  root,
  state: join(temp, "state"),
  token: "test-only-".repeat(8),
  origin,
  port: 0,
});
const url = `http://127.0.0.1:${runner.api.port}`;
let browser;
try {
  const project = runner.projects.read("starter");
  const start = (kind, options = {}) =>
    runner.jobs.start({
      id: project.ref.id,
      revision: project.revision,
      target: "vertical",
      kind,
      requestId: crypto.randomUUID(),
      ...options,
    });
  const wait = async (id) => {
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      const job = runner.jobs.get(id);
      if (job.status === "succeeded") return job;
      if (["failed", "interrupted", "cancelled"].includes(job.status))
        throw new Error(JSON.stringify(job));
      await Bun.sleep(250);
    }
    throw new Error(`Timed out: ${JSON.stringify(runner.jobs.get(id))}`);
  };
  const validation = await wait(start("validate", { profile: "draft" }).id);
  const diagnostics = JSON.parse(
    readFileSync(join(runner.jobs.directory(validation.id), "outputs", "diagnostics.json"), "utf8"),
  );
  assert.equal(diagnostics.fonts.length, 0);
  assert.equal(diagnostics.errors.length, 0);
  const capture = await wait(start("capture", { frames: [0, 30, 120, 600], scale: 0.25 }).id);
  assert.equal(capture.outputs.length, 4);
  for (const output of capture.outputs)
    assert.equal(
      readFileSync(join(runner.jobs.directory(capture.id), "outputs", output.name))
        .subarray(1, 4)
        .toString(),
      "PNG",
    );
  console.log("PNG: four starter keyframes and diagnostics rendered");
  const video = await wait(
    start("video", { from: 160, to: 219, profile: "draft", scale: 0.25 }).id,
  );
  assert(video.outputs[0].size > 1000);
  assert.equal(
    readFileSync(join(runner.jobs.directory(video.id), "outputs", "video.mp4"))
      .subarray(4, 8)
      .toString(),
    "ftyp",
  );
  console.log("MP4: actual 60-frame transition with audio encoded");
  const archive = await wait(start("archive").id);
  const tar = new Bun.Archive(
    readFileSync(join(runner.jobs.directory(archive.id), "outputs", "source.tar.gz")),
  );
  const entries = await tar.files();
  assert(entries.has("work.json") && entries.has("Scene.tsx") && entries.has("bcr-snapshot.json"));
  console.log("Archive: complete source snapshot verified");
  // Export artifacts for visual inspection without preserving the temporary source tree or credentials.
  cpSync(join(runner.jobs.directory(capture.id), "outputs"), "/tmp/bcr-runner-keyframes", {
    recursive: true,
  });
  cpSync(
    join(runner.jobs.directory(video.id), "outputs", "video.mp4"),
    "/tmp/bcr-runner-preview.mp4",
  );
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(30000);
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) console.log("Browser route:", frame.url());
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") console.log("Browser diagnostic:", msg.text().slice(0, 1000));
  });
  await page.goto(`${origin}/works`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "连接 Runner", exact: true }).first().click();
  await page.getByLabel("Runner 地址").fill(url);
  await page.getByLabel("配对密钥").fill("test-only-".repeat(8));
  await page.getByRole("button", { name: "连接", exact: true }).click();
  await page.getByRole("button", { name: "Runner 已连接", exact: true }).waitFor();
  await page.getByLabel("选择作品").selectOption(`${project.ref.sourceId}:starter`);
  await page.getByRole("button", { name: "制作", exact: true }).click();
  assert.equal(new URL(page.url()).searchParams.get("source"), project.ref.sourceId);
  assert.equal(await page.getByLabel("输出目标").inputValue(), "vertical");
  await page.getByLabel("输出目标").selectOption("vertical");
  await page.getByRole("button", { name: "提交审阅", exact: true }).click();
  assert.equal(await page.getByLabel("审阅目标").inputValue(), "vertical");
  await page.getByRole("dialog").getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: /产物与任务/ }).click();
  await page.getByRole("button", { name: "diagnostics.json", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByText(/"fonts"/)
    .waitFor();
  await page.getByRole("button", { name: "关闭产物", exact: true }).click();
  await page.getByRole("button", { name: "frame-30.png", exact: true }).click();
  await page
    .getByRole("dialog")
    .locator("img")
    .evaluate((img) => img.decode());
  await page.getByRole("button", { name: "关闭产物", exact: true }).click();
  await page.getByRole("button", { name: "video.mp4", exact: true }).click();
  await page.getByLabel("导出视频").evaluate(async (video) => {
    await video.play();
    await new Promise((resolve, reject) => {
      video.onended = resolve;
      video.onerror = reject;
    });
  });
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "下载 video.mp4", exact: true }).click();
  assert.equal((await download).suggestedFilename(), "video.mp4");
  await page.getByRole("button", { name: "关闭产物", exact: true }).click();
  await page.getByRole("button", { name: "关闭产物与任务" }).click();
  console.log("Artifacts: diagnostics, keyframe, video playback and download verified");

  await page.getByRole("button", { name: "预览", exact: true }).click();
  const slider = page.getByLabel("预览帧", { exact: true });
  await page.waitForFunction(
    () => {
      const slider = document.querySelector('input[aria-label="预览帧"]');
      return slider && !slider.disabled;
    },
    undefined,
    { timeout: 90000 },
  );
  const player = page.frameLocator('iframe[title="Runner 作品预览"]');
  await player.getByText("NEW WORK", { exact: true }).waitFor();
  assert.equal(await player.locator("canvas").count(), 1, "starter preview mounts a Three.js canvas");
  await slider.fill("360");
  await page.waitForTimeout(150);
  const canvas = player.locator("[data-video-canvas]");
  const beforeSeek = await canvas.screenshot();
  await slider.fill("600");
  await slider.fill("360");
  await page.waitForTimeout(150);
  assert(
    beforeSeek.equals(await canvas.screenshot()),
    "GSAP and frame-driven scenes reproduce after reverse seeking",
  );
  await page.getByRole("button", { name: "版本历史", exact: true }).click();
  await page.getByLabel("检查点说明").fill("开场定稿");
  await page.getByRole("button", { name: "保存检查点", exact: true }).click();
  await page.getByRole("navigation", { name: "源码版本" }).getByText("开场定稿").waitFor();
  await page.getByRole("button", { name: "关闭版本历史" }).click();
  await slider.fill("600");
  await page.getByLabel("示例数值", { exact: true }).fill("1800");
  await player.getByText("结果 3600").waitFor();
  assert.equal(
    JSON.parse(readFileSync(join(root, "data.json"), "utf8")).value,
    42,
    "live preview never writes source",
  );
  assert(await page.getByRole("button", { name: "导出", exact: true }).isDisabled());
  await page.getByRole("button", { name: "版本历史", exact: true }).click();
  assert(await page.getByRole("button", { name: "保存检查点", exact: true }).isDisabled());
  await page.getByRole("button", { name: "关闭版本历史" }).click();
  await page.screenshot({ path: "/tmp/bcr-build-live.png", fullPage: true });
  await page.getByRole("button", { name: "放弃修改", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('input[aria-label="示例数值"]')?.value === "42",
  );
  await player.getByText("结果 84").waitFor();
  await page.getByLabel("示例数值", { exact: true }).fill("1800");
  await player.getByText("结果 3600").waitFor();
  await page.getByRole("button", { name: "保存参数", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('input[aria-label="示例数值"]')?.value === "1800" &&
      !document.querySelector(".build-statusbar")?.textContent.includes("尚未保存"),
  );
  assert.equal(JSON.parse(readFileSync(join(root, "data.json"), "utf8")).value, 1800);
  assert.equal(
    JSON.parse(runner.projects.file("starter", project.revision, "data.json").toString()).value,
    42,
  );
  await page.waitForFunction(
    () => document.querySelector(".build-preview-state")?.textContent === "当前版本",
    undefined,
    { timeout: 90000 },
  );
  await page.waitForFunction(() => !document.querySelector('input[aria-label="预览帧"]')?.disabled);
  await page.screenshot({ path: "/tmp/bcr-runner-workspace.png", fullPage: true });
  await slider.fill("600");
  await player.getByText("结果 3600").waitFor();
  await slider.fill("720");
  await player.getByText("结果 3600").waitFor();
  await slider.fill("360");
  await player.getByRole("button", { name: /play/i }).first().click();
  await page.waitForFunction(
    () => Number(document.querySelector('input[aria-label="预览帧"]')?.value) > 380,
  );
  await player.getByRole("button", { name: /pause/i }).first().click();
  // Pause and the final React frame commit are separate events; allow the private port to settle.
  await page.waitForTimeout(150);
  const playbackFrame = Number(await slider.inputValue());
  assert(playbackFrame > 360, "Works frame display follows playback");
  await page.getByRole("button", { name: "导出", exact: true }).click();
  await page.getByLabel("导出内容").selectOption("capture");
  await page.getByLabel("导出质量", { exact: true }).selectOption("draft");
  await page.getByRole("button", { name: "开始导出", exact: true }).click();
  const captureDeadline = Date.now() + 30000;
  let playbackCapture;
  while (Date.now() < captureDeadline && !playbackCapture) {
    playbackCapture = runner.jobs
      .list("starter")
      .find((job) => job.request.kind === "capture" && job.id !== capture.id);
    if (!playbackCapture) await Bun.sleep(100);
  }
  assert(playbackCapture, "UI creates a keyframe job after playback");
  assert.equal(playbackCapture.request.frames[0], playbackFrame);
  assert.equal(playbackCapture.request.profile, "draft");
  await wait(playbackCapture.id);
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: "/tmp/bcr-build-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "版本历史", exact: true }).click();
  await page.getByRole("navigation", { name: "源码版本" }).getByText("开场定稿").click();
  await page.getByLabel("源码差异").getByText('"value": 1800', { exact: false }).waitFor();
  await page.screenshot({ path: "/tmp/bcr-build-history.png", fullPage: true });
  await page.getByRole("button", { name: "恢复为当前版本", exact: true }).click();
  await page.getByRole("button", { name: "保留当前并恢复", exact: true }).click();
  await page.getByRole("dialog", { name: "版本历史" }).waitFor({ state: "hidden" });
  assert.equal(JSON.parse(readFileSync(join(root, "data.json"), "utf8")).value, 42);
  await page.getByLabel("输出目标").selectOption("page");
  await page.getByRole("button", { name: "预览", exact: true }).click();
  await page
    .frameLocator('iframe[title="Runner 作品预览"]')
    .getByRole("heading", { name: "从一个问题开始。" })
    .waitFor({ timeout: 60000 });
  await page.setViewportSize({ width: 1440, height: 1000 });
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log(
    "PASS: Runner connection, preview, parameters, versions, artifacts and responsive layout",
  );
} catch (error) {
  if (browser) {
    const page = browser.contexts()[0]?.pages()[0];
    await page?.screenshot({ path: "/tmp/bcr-runner-failure.png", fullPage: true });
    writeFileSync(
      "/tmp/bcr-runner-failure.txt",
      (await page?.locator("body").innerText()) ?? "No page",
    );
  }
  throw error;
} finally {
  await browser?.close();
  await runner.close();
  rmSync(temp, { recursive: true, force: true });
}
