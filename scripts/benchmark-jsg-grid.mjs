import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const [input, destination] = process.argv.slice(2);
if (!input || !destination)
  throw new Error("Usage: node scripts/benchmark-jsg-grid.mjs SNAPSHOT_DIR REPORT_DIR");
const root = path.resolve(input),
  dir = path.resolve(destination);
mkdirSync(dir, { recursive: true });
const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));
const profile = mkdtempSync(path.join(dir, "profile-"));
const context = await chromium.launchPersistentContext(profile, {
  headless: true,
  viewport: { width: 1440, height: 1000 },
});
const page = context.pages()[0],
  errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.addInitScript(() => {
  window.__gridLongTasks = [];
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries())
      window.__gridLongTasks.push({ at: entry.startTime, duration: entry.duration });
  }).observe({ type: "longtask", buffered: true });
});
const open = async () => {
  await page.locator(".research-action-menu > summary").click();
  await page.getByRole("button", { name: "参数实验", exact: true }).click();
};
const completed = (old) =>
  page.waitForFunction(
    (id) =>
      document.querySelector(".jsg-workspace")?.getAttribute("data-busy") === "false" &&
      document.querySelector(".research-taskbar")?.textContent?.includes("参数实验完成") &&
      document.querySelector(".research-grid-results") !== null &&
      document.querySelector(".research-grid-results")?.getAttribute("data-grid-id") !== id,
    old,
    { timeout: 180_000 },
  );
const exported = async () => {
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出参数实验", exact: true }).click();
  const file = path.join(dir, "grid.json");
  await (await event).saveAs(file);
  return JSON.parse(readFileSync(file, "utf8"));
};
try {
  await page.goto(process.env.BASE_URL ?? "http://localhost:5201/?strategy=jsg", {
    waitUntil: "networkidle",
  });
  await page.waitForFunction(() => !document.querySelector(".research-run-button")?.disabled);
  await page
    .getByLabel("导入 JSG 研究数据", { exact: true })
    .setInputFiles([
      path.join(root, "manifest.json"),
      ...manifest.partitions.map((p) => path.join(root, p.file)),
    ]);
  await page.waitForFunction(
    () => document.querySelector(".research-taskbar")?.textContent?.startsWith("研究数据就绪"),
    undefined,
    { timeout: 180_000 },
  );
  await open();
  await page.getByLabel("目标股票数候选值", { exact: true }).fill("4,6,8,10");
  await page.getByLabel("个股止损候选值", { exact: true }).fill("0,3,5,8");
  const startAt = await page.evaluate(() => performance.now()),
    started = performance.now();
  await page.getByRole("button", { name: "运行参数实验", exact: true }).click();
  await completed(null);
  const elapsedMs = performance.now() - started,
    endAt = await page.evaluate(() => performance.now());
  const grid = await exported();
  assert.equal(grid.result.results.length, 16);
  assert.equal(
    grid.result.decodedRows,
    manifest.partitions.reduce((n, p) => n + p.rows, 0),
  );
  const configs = grid.result.results.map((row) => row.config);
  writeFileSync(path.join(dir, "configs.json"), JSON.stringify(configs));
  const before = await page.locator(".research-grid-results").getAttribute("data-grid-id");
  await open();
  const cacheStart = performance.now();
  await page.getByRole("button", { name: "运行参数实验", exact: true }).click();
  await completed(before);
  const cacheMs = performance.now() - cacheStart;
  const cached = await exported();
  assert.equal(cached.experiment.cached, true);
  assert.deepEqual(cached.result, grid.result);
  const cachedId = await page.locator(".research-grid-results").getAttribute("data-grid-id");
  await open();
  await page.getByLabel("目标股票数候选值", { exact: true }).fill("1,2,3,4,5,6,7,8");
  await page.getByLabel("个股止损候选值", { exact: true }).fill("0,1,2,3,4,5,6,7");
  await page.getByRole("button", { name: "运行参数实验", exact: true }).click();
  await page.getByRole("button", { name: "取消研究任务", exact: true }).waitFor();
  const cancelStart = performance.now();
  await page.getByRole("button", { name: "取消研究任务", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "已取消，已有结果保留" }).waitFor();
  const cancelMs = performance.now() - cancelStart;
  assert.equal(await page.locator(".research-grid-results").getAttribute("data-grid-id"), cachedId);
  const mainThreadLongTasks = await page.evaluate(
    ({ startAt, endAt }) =>
      window.__gridLongTasks.filter((task) => task.at >= startAt && task.at <= endAt),
    { startAt, endAt },
  );
  assert.deepEqual(errors, []);
  const report = {
    rows: grid.result.decodedRows,
    combinations: 16,
    elapsedMs,
    cacheMs,
    cancelMs,
    workerTimings: grid.result.timings,
    mainThreadLongTasks,
    note: "One browser Worker; each daily Arrow batch and market feature set shared across independent portfolios; metrics only. OS cache warm; UI wall times include automation waits.",
  };
  writeFileSync(path.join(dir, "statistics.json"), JSON.stringify(report, null, 2));
  // Keep the first measured experiment; its configs are the exact native comparison input.
  writeFileSync(path.join(dir, "grid.json"), JSON.stringify(grid));
  console.log(JSON.stringify(report));
} finally {
  await context.close();
}
