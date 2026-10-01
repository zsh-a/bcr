import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ensureShots, launchEphemeralBrowser } from "./lib/browser.mjs";

// Optional integration against an explicitly selected read-only source; no database writes.
const source = process.env.CLICKHOUSE_TEST_URL ?? "http://localhost:8123/";
const database = process.env.CLICKHOUSE_DATABASE ?? "stock_data";
const user = process.env.CLICKHOUSE_USER ?? "default";
const password = process.env.CLICKHOUSE_PASSWORD ?? "";
const start = process.env.JSG_TEST_START ?? "2026-04-01";
const end = process.env.JSG_TEST_END ?? "2026-06-30";
const url = new URL(process.env.BASE_URL ?? "http://localhost:5201/");
if (url.pathname.startsWith("/studio")) url.pathname = "/quant";
url.searchParams.set("strategy", "jsg");
const shots = ensureShots();
const browser = await launchEphemeralBrowser({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
});
if (/^(localhost|127\.0\.0\.1|\[::1\])$/u.test(new URL(source).hostname))
  await context.grantPermissions(["local-network-access"], { origin: url.origin });
const page = await context.newPage();
const errors = [];
let queries = 0,
  arrowQueries = 0,
  fail = false,
  delay = false;
context.on("request", (request) => {
  if (request.method() === "POST" && request.url().startsWith(source)) {
    queries++;
    if (request.postData()?.includes("FORMAT ArrowStream")) arrowQueries++;
  }
});
await context.route(`${source}**`, async (route) => {
  if (route.request().postData()?.includes("FORMAT ArrowStream")) {
    if (fail) {
      await route.fulfill({
        status: 502,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: "fixture connection failure",
      });
      return;
    }
    if (delay) await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  await route.continue().catch(() => undefined);
});
page.on("pageerror", (error) => errors.push(error.message));
const open = async () => {
  await page.getByRole("button", { name: "运行设置", exact: true }).click();
  await page.getByRole("tab", { name: "数据与区间", exact: true }).click();
  await page.locator(".research-source-options > button").first().click();
  await page.locator(".research-data-settings .research-parameter-details").evaluate((el) => {
    el.open = true;
  });
};
const close = async () => {
  await page.getByRole("button", { name: "关闭运行设置", exact: true }).click();
  await page.getByRole("dialog", { name: "运行设置", exact: true }).waitFor({ state: "hidden" });
};
const dates = open;
const applyDates = close;
let previousRun = null;
const load = async () => {
  const result = page.locator(".research-run-result");
  previousRun = (await result.count()) ? await result.getAttribute("data-run-id") : null;
  await page.getByRole("button", { name: "运行回测", exact: true }).click();
};
const done = () =>
  page.waitForFunction(
    (id) =>
      document.querySelector(".jsg-workspace")?.getAttribute("data-busy") === "false" &&
      document.querySelector(".research-status")?.textContent?.includes("回测完成") &&
      document.querySelector(".research-run-result") !== null &&
      document.querySelector(".research-run-result")?.getAttribute("data-run-id") !== id,
    previousRun,
    { timeout: 90_000 },
  );
const exportResult = async (name) => {
  await page.locator(".research-action-menu > summary").click();
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出结果", exact: true }).click();
  const path = `${shots}/${name}`;
  await (await event).saveAs(path);
  return JSON.parse(readFileSync(path, "utf8"));
};
const inventory = () =>
  page.evaluate(async () => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle("quant");
    const paths = [];
    async function walk(dir, prefix) {
      for await (const [name, handle] of dir.entries()) {
        if (handle.kind === "directory") await walk(handle, `${prefix}${name}/`);
        else if (prefix.startsWith("artifacts/jsg/") || prefix.startsWith("temp/"))
          paths.push(`${prefix}${name}`);
      }
    }
    await walk(root, "");
    return paths.sort((a, b) => a.localeCompare(b));
  });
try {
  await page.goto(url.toString(), { waitUntil: "networkidle" });
  await open();
  await page.getByLabel("ClickHouse 地址", { exact: true }).fill(source);
  await page.getByLabel("ClickHouse 数据库", { exact: true }).fill(database);
  await page.getByLabel("ClickHouse 用户名", { exact: true }).fill(user);
  await page.getByLabel("ClickHouse 密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "测试连接", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector(".research-connection-status")?.getAttribute("data-connected") ===
      "true",
  );
  await close();
  await dates();
  await page.getByLabel("回测开始日期", { exact: true }).fill(start);
  await page.getByLabel("回测结束日期", { exact: true }).fill(end);
  await page.screenshot({ path: `${shots}/jsg-clickhouse-connection.png`, fullPage: true });
  await applyDates();
  await load();
  await done();
  const first = await exportResult("jsg-clickhouse-result.json");
  assert.equal(
    first.manifest.source,
    `Browser / ClickHouse ${new URL(source).toString()} / ${database}`,
  );
  assert.equal(first.result.metrics.days, first.result.equity.length);
  assert(first.result.metrics.filledOrders > 0);
  assert(arrowQueries > 0);
  assert(Number.isFinite(Date.parse(first.snapshot.createdAt)));
  assert.equal(first.snapshot.request.start, start);
  assert.equal(first.snapshot.request.end, end);
  assert(!Object.hasOwn(first.snapshot.request, "password"));
  assert.equal(await page.locator(".jsg-workspace").getAttribute("data-draft-changed"), "false");
  assert(first.snapshot.timings.downloadedBytes > 0);
  await page.screenshot({ path: `${shots}/jsg-clickhouse-result.png`, fullPage: true });
  await page.getByRole("tab", { name: "分析", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector(".research-evaluation")?.getAttribute("aria-busy") === "false" &&
      document.querySelector(".research-period-table tbody tr"),
  );
  await page.getByRole("button", { name: "设置基准", exact: true }).click();
  await page.getByRole("button", { name: "获取并绑定基准", exact: true }).click();
  await page
    .getByRole("dialog", { name: "设置研究基准", exact: true })
    .waitFor({ state: "hidden" });
  await page.waitForFunction(
    () =>
      document.querySelector(".research-evaluation")?.getAttribute("aria-busy") === "false" &&
      document.querySelector(".research-evaluation-chart"),
  );
  const evaluationDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出研究评估", exact: true }).click();
  await (await evaluationDownload).saveAs(`${shots}/jsg-clickhouse-evaluation.json`);
  const evaluation = JSON.parse(readFileSync(`${shots}/jsg-clickhouse-evaluation.json`, "utf8"));
  assert.equal(evaluation.benchmark.kind, "price");
  assert.equal(evaluation.benchmark.points.length, first.result.metrics.days + 1);
  assert(
    Math.abs(evaluation.evaluation.strategy.totalReturn - first.result.metrics.totalReturn) < 1e-12,
  );
  assert(!JSON.stringify(evaluation).includes('"password"'));
  const beforeGridQueries = queries;
  await page.locator(".research-action-menu > summary").click();
  await page.getByRole("button", { name: "参数实验", exact: true }).click();
  await page.getByRole("button", { name: "运行参数实验", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector(".research-status")?.textContent?.includes("参数实验完成") &&
      document.querySelector(".jsg-workspace")?.getAttribute("data-busy") === "false",
  );
  assert.equal(queries, beforeGridQueries, "parameter grid must reuse the acquired snapshot");
  assert.equal(await page.locator(".research-grid-table tbody tr").count(), 4);
  const firstArrowQueries = arrowQueries;
  // Shift the start within the same source calendar: interior daily partitions remain reusable.
  const shiftedStart = new Date(`${start}T00:00:00Z`);
  shiftedStart.setUTCDate(shiftedStart.getUTCDate() + 7);
  await dates();
  await page
    .getByLabel("回测开始日期", { exact: true })
    .fill(shiftedStart.toISOString().slice(0, 10));
  await applyDates();
  await load();
  await done();
  assert(
    arrowQueries - firstArrowQueries < firstArrowQueries,
    "overlap must download fewer partitions",
  );
  assert((await exportResult("jsg-clickhouse-overlap.json")).snapshot.reusedPartitions > 0);
  await dates();
  await page.getByLabel("回测开始日期", { exact: true }).fill(start);
  await applyDates();
  await load();
  await done();
  assert.deepEqual(
    (await exportResult("jsg-clickhouse-overlap-restored.json")).result,
    first.result,
  );
  const count = queries;
  await open();
  // Cached snapshots are local data: they can be reused without sending a password.
  await page.getByLabel("ClickHouse 密码", { exact: true }).fill("session-only-placeholder");
  await close();
  await load();
  await done();
  assert.equal(queries, count);
  assert((await page.locator(".research-status").innerText()).includes("复用已有结果"));
  assert.deepEqual((await exportResult("jsg-clickhouse-cached.json")).result, first.result);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() =>
    document.querySelector(".research-status")?.textContent?.includes("已恢复本地研究"),
  );
  await open();
  assert.equal(await page.getByLabel("ClickHouse 密码", { exact: true }).inputValue(), "");
  await page.getByLabel("ClickHouse 密码", { exact: true }).fill(password);
  await close();
  await dates();
  assert.equal(await page.getByLabel("回测开始日期", { exact: true }).inputValue(), start);
  await page.getByLabel("重新获取数据", { exact: true }).check();
  await applyDates();
  const before = await inventory();
  fail = true;
  await load();
  await page.getByRole("alert").filter({ hasText: "502" }).waitFor();
  fail = false;
  assert.deepEqual(await inventory(), before);
  delay = true;
  const requested = context.waitForEvent("request", {
    predicate: (request) => request.postData()?.includes("FORMAT ArrowStream") === true,
  });
  await load();
  await requested;
  await page.getByRole("button", { name: "取消研究任务", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "已取消，已有结果保留" }).waitFor();
  delay = false;
  assert.deepEqual(await inventory(), before);
  assert.deepEqual((await exportResult("jsg-clickhouse-preserved.json")).result, first.result);
  await dates();
  await page.getByLabel("重新获取数据", { exact: true }).uncheck();
  await applyDates();
  await open();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert(await page.getByRole("button", { name: "测试连接", exact: true }).isVisible());
  await page.screenshot({ path: `${shots}/jsg-clickhouse-mobile.png`, fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    `ClickHouse browser verification PASSED: ${first.result.metrics.days} days; connect, Arrow load, benchmark evaluation, parameter grid, overlap reuse, cache, password lifetime, failed refresh, cancel, restore, mobile`,
  );
} catch (error) {
  await page
    .screenshot({ path: `${shots}/jsg-clickhouse-failure.png`, fullPage: true })
    .catch(() => undefined);
  console.error(
    await page
      .locator(".jsg-workspace")
      .innerText()
      .catch(() => "dialog unavailable"),
  );
  throw error;
} finally {
  await browser.close();
}
