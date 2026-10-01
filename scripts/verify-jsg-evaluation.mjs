import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { ensureShots, launchEphemeralBrowser, repoRoot } from "./lib/browser.mjs";
const shots = ensureShots();
execFileSync(
  "bun",
  [
    "-e",
    `import {writeFileSync,mkdirSync} from "node:fs";import {demoResearch} from "./apps/quant-lab/src/jsg/demo.ts";mkdirSync("scripts/shots/evaluation-input",{recursive:true});for(const file of demoResearch().files)writeFileSync("scripts/shots/evaluation-input/"+file.name,new Uint8Array(await file.arrayBuffer()));`,
  ],
  { cwd: repoRoot },
);
const manifest = JSON.parse(readFileSync(`${shots}/evaluation-input/manifest.json`, "utf8"));
const date = (d) => `${String(d).slice(0, 4)}-${String(d).slice(4, 6)}-${String(d).slice(6)}`;
const dates = manifest.calendar
  .filter((s) => s.date >= manifest.startDate)
  .map((s) => date(s.date));
const baseline = date(manifest.calendar.filter((s) => s.date < manifest.startDate).at(-1).date);
const prices = [baseline, ...dates].map((date, i) => ({ date, close: 100 * 1.0005 ** i }));
const csv = `date,close\n${prices.map((p) => `${p.date},${p.close}`).join("\n")}\n`;
writeFileSync(`${shots}/evaluation-benchmark.csv`, csv);
writeFileSync(
  `${shots}/evaluation-invalid.csv`,
  `date,close\n${prices
    .slice(1)
    .map((p) => `${p.date},${p.close}`)
    .join("\n")}`,
);
const url = new URL(process.env.BASE_URL ?? "http://127.0.0.1:5205/");
if (url.pathname.startsWith("/studio")) url.pathname = "/quant";
url.search = "";
const browser = await launchEphemeralBrowser({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
});
await context.grantPermissions(["local-network-access"], { origin: url.origin });
const page = await context.newPage(),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let delay = false,
  queries = 0;
await context.route("http://localhost:8123/**", async (route) => {
  const body = route.request().postData() ?? "";
  queries++;
  if (body.includes("1 AS connected")) {
    await route.fulfill({
      body: '{"connected":1}\n',
      headers: { "Access-Control-Allow-Origin": "*" },
    });
    return;
  }
  if (delay) await new Promise((r) => setTimeout(r, 1500));
  assert(body.includes("stock_daily FINAL"));
  assert.equal(new URL(route.request().url()).searchParams.get("param_code"), "sh.000300");
  await route
    .fulfill({
      body: prices.map((p) => JSON.stringify(p)).join("\n"),
      headers: { "Access-Control-Allow-Origin": "*" },
    })
    .catch(() => undefined);
});
const ready = () =>
  page.waitForFunction(
    () =>
      document.querySelector(".research-evaluation")?.getAttribute("aria-busy") === "false" &&
      document.querySelector(".research-period-table tbody tr"),
  );
const exportEvaluation = async (name) => {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出研究评估", exact: true }).click();
  const path = `${shots}/${name}.json`;
  await (await download).saveAs(path);
  return JSON.parse(readFileSync(path, "utf8"));
};
const exportFull = async () => {
  await page.locator(".research-action-menu > summary").click();
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出结果", exact: true }).click();
  const path = `${shots}/evaluation-full.json`;
  await (await event).saveAs(path);
  return JSON.parse(readFileSync(path, "utf8"));
};
const open = () => page.getByRole("button", { name: "设置基准", exact: true }).click();
const dialog = () => page.getByRole("dialog", { name: "设置研究基准", exact: true });
const close = async () => {
  await page.keyboard.press("Escape");
  await dialog().waitFor({ state: "hidden" });
};
const benchmarkFiles = () =>
  page.evaluate(async () => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle("quant");
    try {
      const artifacts = await root.getDirectoryHandle("artifacts"),
        jsg = await artifacts.getDirectoryHandle("jsg"),
        dir = await jsg.getDirectoryHandle("benchmark"),
        names = [];
      for await (const [name] of dir.entries()) names.push(name);
      return names;
    } catch {
      return [];
    }
  });
const cleanup = async () => {
  await page.locator(".research-action-menu > summary").click();
  await page.getByRole("button", { name: "数据与存储", exact: true }).click();
  await page.locator(".research-snapshot-list > div").first().waitFor();
  await page.getByRole("button", { name: "清理未使用数据", exact: true }).click();
  await page.getByRole("button", { name: "确认清理", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: /^已释放/ })
    .waitFor();
  await page.waitForFunction(
    () => document.querySelector(".jsg-workspace")?.getAttribute("data-busy") === "false",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "数据与存储", exact: true }).waitFor({ state: "hidden" });
};
try {
  await page.goto(url.toString(), { waitUntil: "networkidle" });
  await page.waitForFunction(() => !document.querySelector(".research-run-button")?.disabled);
  await page
    .getByLabel("导入 JSG 研究数据", { exact: true })
    .setInputFiles([
      `${shots}/evaluation-input/manifest.json`,
      ...manifest.partitions.map((p) => `${shots}/evaluation-input/${p.file}`),
    ]);
  await page.getByRole("status").filter({ hasText: "研究数据就绪" }).waitFor();
  await page.getByRole("button", { name: "运行回测", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector(".jsg-workspace")?.getAttribute("data-busy") === "false" &&
      document.querySelector(".research-run-result"),
  );
  const full = await exportFull(),
    originalId = await page.locator(".research-run-result").getAttribute("data-run-id");
  assert.equal(full.research.versions.engine, "jsg-engine-2");
  await page.getByRole("tab", { name: "分析", exact: true }).click();
  await ready();
  const first = await exportEvaluation("evaluation-strategy");
  for (const field of ["days", "totalReturn", "annualizedReturn", "sharpe", "maxDrawdown"])
    assert(Math.abs(first.evaluation.strategy[field] - full.result.metrics[field]) < 1e-10);
  assert(
    Math.abs(
      first.evaluation.months.reduce((n, p) => n * (1 + p.strategy), 1) -
        1 -
        full.result.metrics.totalReturn,
    ) < 1e-12,
  );
  await open();
  await page.getByLabel("基准数据来源", { exact: true }).selectOption("csv");
  await page.getByLabel("基准名称", { exact: true }).fill("固定全收益基准");
  await page.getByLabel("基准收益类型", { exact: true }).selectOption("total-return");
  await page
    .getByLabel("导入基准 CSV", { exact: true })
    .setInputFiles(`${shots}/evaluation-benchmark.csv`);
  await dialog().waitFor({ state: "hidden" });
  await ready();
  const bound = await exportEvaluation("evaluation-csv");
  assert.equal(bound.benchmark.kind, "total-return");
  assert.equal(bound.run.id, originalId);
  assert(
    Math.abs(bound.evaluation.benchmark.stats.totalReturn - (1.0005 ** dates.length - 1)) < 1e-12,
  );
  assert.equal(
    await page.locator(".research-period-table tbody tr").count(),
    bound.evaluation.months.length,
  );
  await page.getByLabel("分期收益频率", { exact: true }).selectOption("years");
  assert.equal(await page.locator(".research-period-table tbody tr").count(), 1);
  await page.getByLabel("分期收益频率", { exact: true }).selectOption("months");
  await open();
  await page
    .getByLabel("导入基准 CSV", { exact: true })
    .setInputFiles(`${shots}/evaluation-invalid.csv`);
  await dialog().getByRole("alert").filter({ hasText: "缺少交易日" }).waitFor();
  await close();
  assert.deepEqual((await exportEvaluation("evaluation-preserved")).benchmark, bound.benchmark);
  await open();
  await page.getByLabel("基准数据来源", { exact: true }).selectOption("clickhouse");
  await page.getByRole("button", { name: "获取并绑定基准", exact: true }).click();
  await dialog().waitFor({ state: "hidden" });
  await ready();
  const fetched = await exportEvaluation("evaluation-clickhouse");
  assert.equal(fetched.benchmark.kind, "price");
  assert.equal(fetched.benchmark.name, "沪深300");
  assert(queries >= 2);
  delay = true;
  await open();
  await page.getByRole("button", { name: "获取并绑定基准", exact: true }).click();
  await page.getByRole("button", { name: "取消基准获取", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  assert(await dialog().isVisible());
  await page.getByRole("button", { name: "取消基准获取", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector(".jsg-workspace")?.getAttribute("data-busy") === "false",
  );
  await close();
  delay = false;
  assert.equal(
    (await exportEvaluation("evaluation-cancelled")).run.benchmark.ref.id,
    fetched.run.benchmark.ref.id,
  );
  await page.getByRole("button", { name: "运行设置", exact: true }).click();
  await page.getByRole("tab", { name: "参数", exact: true }).click();
  await page.getByLabel("目标股票数", { exact: true }).fill("6");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "运行设置", exact: true }).waitFor({ state: "hidden" });
  assert.equal((await exportEvaluation("evaluation-draft")).run.config.stockCount, 10);
  await page.locator(".research-evaluation-conventions summary").click();
  await page
    .locator(".research-evaluation")
    .evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.screenshot({ path: `${shots}/jsg-evaluation-desktop.png`, fullPage: true });
  const withBenchmark = await exportFull();
  assert.deepEqual(withBenchmark.research.benchmark.snapshot, fetched.benchmark);
  assert.deepEqual(withBenchmark.result, full.result);
  const before = queries;
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() =>
    document.querySelector(".research-status")?.textContent?.includes("已恢复本地研究"),
  );
  await page.getByRole("tab", { name: "分析", exact: true }).click();
  await ready();
  const restored = await exportEvaluation("evaluation-restored");
  assert.equal(queries, before);
  assert.deepEqual(restored.benchmark, fetched.benchmark);
  assert.equal(restored.run.config.stockCount, 10);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page
      .locator(".research-evaluation")
      .evaluate((el) => el.scrollIntoView({ block: "start" }));
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `${shots}/jsg-evaluation-mobile-${width}.png`, fullPage: true });
    await open();
    assert(await dialog().evaluate((el) => el.getBoundingClientRect().width <= innerWidth));
    await close();
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await cleanup();
  let files = await benchmarkFiles();
  assert(files.includes(fetched.run.benchmark.ref.id.split("/").at(-1)));
  assert(!files.includes(bound.run.benchmark.ref.id.split("/").at(-1)));
  assert.deepEqual(
    (await exportEvaluation("evaluation-after-cleanup")).benchmark,
    fetched.benchmark,
  );
  await page.getByRole("button", { name: "移除所选运行基准", exact: true }).click();
  await ready();
  assert.equal((await exportEvaluation("evaluation-unbound")).benchmark, undefined);
  await cleanup();
  files = await benchmarkFiles();
  assert(!files.includes(fetched.run.benchmark.ref.id.split("/").at(-1)));
  assert.deepEqual(errors, []);
  console.log(
    "JSG evaluation verification PASSED: complete-result parity, periods, CSV/ClickHouse benchmark, strict alignment, immutable export, cancel, restore, draft independence, storage reclamation, mobile",
  );
} catch (error) {
  await page
    .screenshot({ path: `${shots}/jsg-evaluation-failure.png`, fullPage: true })
    .catch(() => undefined);
  console.error(
    (
      await page
        .locator(".jsg-workspace")
        .innerText()
        .catch(() => "")
    ).slice(-6000),
  );
  throw error;
} finally {
  await context.close();
  await browser.close();
}
