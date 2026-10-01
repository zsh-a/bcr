import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
const [input, destination] = process.argv.slice(2);
if (!input || !destination)
  throw new Error("Usage: node scripts/benchmark-jsg-evaluation.mjs SNAPSHOT_DIR REPORT_DIR");
const root = path.resolve(input),
  dir = path.resolve(destination),
  manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));
mkdirSync(dir, { recursive: true });
const context = await chromium.launchPersistentContext(mkdtempSync(path.join(dir, "profile-")), {
    headless: true,
    viewport: { width: 1440, height: 1000 },
  }),
  page = context.pages()[0],
  errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.addInitScript(() => {
  window.__evaluationTasks = [];
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries())
      if (window.__evaluationTasks.length < 1000)
        window.__evaluationTasks.push({ at: entry.startTime, duration: entry.duration });
  }).observe({ type: "longtask", buffered: true });
});
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
    () => document.querySelector(".research-status")?.textContent?.startsWith("研究数据就绪"),
    undefined,
    { timeout: 180000 },
  );
  await page.getByRole("button", { name: "运行回测", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector(".jsg-workspace")?.getAttribute("data-busy") === "false" &&
      document.querySelector(".research-run-result"),
    undefined,
    { timeout: 180000 },
  );
  const startAt = await page.evaluate(() => performance.now()),
    start = performance.now();
  await page.getByRole("tab", { name: "分析", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector(".research-evaluation")?.getAttribute("aria-busy") === "false" &&
      document.querySelector(".research-period-table tbody tr"),
  );
  const elapsedMs = performance.now() - start,
    endAt = await page.evaluate(() => performance.now());
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出研究评估", exact: true }).click();
  await (await download).saveAs(path.join(dir, "evaluation.json"));
  const exported = JSON.parse(readFileSync(path.join(dir, "evaluation.json"), "utf8"));
  assert.equal(
    exported.evaluation.strategy.days,
    manifest.calendar.filter((s) => s.date >= manifest.startDate).length,
  );
  assert(exported.evaluation.curve.length <= 3072);
  assert.equal(
    await page.locator(".research-period-table tbody tr").count(),
    Math.min(24, exported.evaluation.months.length),
  );
  if (exported.evaluation.months.length > 24) {
    await page.getByRole("button", { name: "下一页分期收益", exact: true }).click();
    assert.equal(
      await page.locator(".research-period-table tbody tr").count(),
      Math.min(24, exported.evaluation.months.length - 24),
    );
  }
  assert(
    Math.abs(
      exported.evaluation.months.reduce((v, p) => v * (1 + p.strategy), 1) -
        1 -
        exported.evaluation.strategy.totalReturn,
    ) < 1e-12,
  );
  const mainThreadLongTasks = await page.evaluate(
    ({ startAt, endAt }) =>
      window.__evaluationTasks.filter((e) => e.at >= startAt && e.at <= endAt),
    { startAt, endAt },
  );
  assert.deepEqual(errors, []);
  const report = {
    inputRows: manifest.partitions.reduce((n, p) => n + p.rows, 0),
    days: exported.evaluation.strategy.days,
    months: exported.evaluation.months.length,
    curvePoints: exported.evaluation.curve.length,
    elapsedMs,
    mainThreadLongTasks,
    note: "Single warmed Chromium observation; timing includes UI automation; analysis reads complete result chunks, not market rows. No browser memory sampling.",
  };
  writeFileSync(path.join(dir, "statistics.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await context.close();
}
