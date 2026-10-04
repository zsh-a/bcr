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
cpSync(resolve("apps/work-runner/example"), root, { recursive: true });
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
  const project = runner.projects.read("gym-card");
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
  const capture = await wait(start("capture", { frames: [0, 360, 1500], scale: 0.25 }).id);
  assert.equal(capture.outputs.length, 3);
  for (const output of capture.outputs)
    assert.equal(
      readFileSync(join(runner.jobs.directory(capture.id), "outputs", output.name))
        .subarray(1, 4)
        .toString(),
      "PNG",
    );
  console.log("PNG: three deterministic keyframes rendered");
  const video = await wait(start("video", { from: 350, to: 379, scale: 0.25 }).id);
  assert(video.outputs[0].size > 1000);
  assert.equal(
    readFileSync(join(runner.jobs.directory(video.id), "outputs", "video.mp4"))
      .subarray(4, 8)
      .toString(),
    "ftyp",
  );
  console.log("MP4: actual 30-frame segment encoded");
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
  await page.getByRole("button", { name: "连接本地工程", exact: true }).first().click();
  await page.getByLabel("Runner 地址").fill(url);
  await page.getByLabel("配对密钥").fill("test-only-".repeat(8));
  await page.getByRole("button", { name: "连接", exact: true }).click();
  await page.getByRole("button", { name: "本地已连接", exact: true }).waitFor();
  await page.getByLabel("选择作品").selectOption("local:gym-card");
  await page.getByLabel("输出目标").selectOption("vertical");
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
  const player = page.frameLocator('iframe[title="本地作品预览"]');
  assert(
    await player
      .getByAltText("作品标记")
      .evaluate((img) => img.complete && img.naturalWidth === 32),
  );
  assert.equal(
    await player.locator(".scene-kicker").evaluate((el) => getComputedStyle(el).display),
    "flex",
  );
  await slider.fill("360");
  await page.getByLabel("画面批注").fill("第 12 秒增加数值强调");
  await page.getByRole("button", { name: "记录批注", exact: true }).click();
  await page.locator(".works-review").filter({ hasText: "第 12 秒增加数值强调" }).waitFor();
  assert.equal(runner.projects.reviews("gym-card").items[0].frame, 360);
  assert.equal(runner.projects.read("gym-card").revision, project.revision);
  await page.getByLabel("年卡价格（元）", { exact: true }).fill("1800");
  await page.getByRole("button", { name: "保存参数", exact: true }).click();
  await page.getByText("动画预览 · 较早版本", { exact: true }).waitFor();
  assert.equal(JSON.parse(readFileSync(join(root, "data.json"), "utf8")).annualPrice, 1800);
  assert.equal(
    JSON.parse(runner.projects.file("gym-card", project.revision, "data.json").toString())
      .annualPrice,
    1680,
  );
  await page.screenshot({ path: "/tmp/bcr-runner-workspace.png", fullPage: true });
  await page.getByRole("button", { name: "预览", exact: true }).click();
  await page.getByText("动画预览", { exact: true }).waitFor({ timeout: 90000 });
  await page.waitForFunction(() => !document.querySelector('input[aria-label="预览帧"]')?.disabled);
  await slider.fill("713"); // At 30 fps the sample shows 36 visits, exactly ¥1800 either way.
  await player.getByText("两种方案现金支出相同。", { exact: true }).waitFor();
  await slider.fill("1500");
  await player.getByText("第 37 次起，年卡更省钱。").waitFor();
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
  await page.getByRole("button", { name: "导出关键帧", exact: true }).click();
  const captureDeadline = Date.now() + 30000;
  let playbackCapture;
  while (Date.now() < captureDeadline && !playbackCapture) {
    playbackCapture = runner.jobs
      .list("gym-card")
      .find((job) => job.request.kind === "capture" && job.id !== capture.id);
    if (!playbackCapture) await Bun.sleep(100);
  }
  assert(playbackCapture, "UI creates a keyframe job after playback");
  assert.equal(playbackCapture.request.frames[0], playbackFrame);
  await wait(playbackCapture.id);
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.getByLabel("输出目标").selectOption("page");
  await page.getByRole("button", { name: "预览", exact: true }).click();
  await page
    .frameLocator('iframe[title="本地作品预览"]')
    .getByRole("heading", { name: "年卡，去多少次才划算？" })
    .waitFor({ timeout: 60000 });
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log(
    "Browser: paired provider, player seek, timestamped review, source update, stale-preview indicator, equality and strict break-even, HTML target, mobile layout",
  );
  console.log("PASS: unified Works local rendering");
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
