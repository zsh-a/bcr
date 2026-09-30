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
const open = () => page.getByRole("button", { name: "连接 ClickHouse", exact: true }).click();
const load = () => page.getByRole("button", { name: "加载并回测", exact: true }).click();
const done = () =>
  page.waitForFunction(
    () =>
      !document.querySelector(".jsg-connection-dialog")?.open &&
      !document.querySelector(".ql-actions > .ui-btn-primary")?.disabled &&
      document.querySelector(".jsg-footer")?.textContent?.includes("回测完成"),
    undefined,
    { timeout: 90_000 },
  );
const exportResult = async (name) => {
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
      document.querySelector(".jsg-connection-status")?.getAttribute("data-connected") === "true",
  );
  await page.getByLabel("回测开始日期", { exact: true }).fill(start);
  await page.getByLabel("回测结束日期", { exact: true }).fill(end);
  await page.screenshot({ path: `${shots}/jsg-clickhouse-connection.png`, fullPage: true });
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
  await page.screenshot({ path: `${shots}/jsg-clickhouse-result.png`, fullPage: true });
  const count = queries;
  await open();
  // Cached snapshots are local data: they can be reused without sending a password.
  await page.getByLabel("ClickHouse 密码", { exact: true }).fill("session-only-placeholder");
  await load();
  await done();
  assert.equal(queries, count);
  assert((await page.locator(".jsg-footer").innerText()).includes("复用已有结果"));
  assert.deepEqual((await exportResult("jsg-clickhouse-cached.json")).result, first.result);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() =>
    document.querySelector(".jsg-footer")?.textContent?.includes("已恢复本地研究"),
  );
  await open();
  assert.equal(await page.getByLabel("ClickHouse 密码", { exact: true }).inputValue(), "");
  assert.equal(await page.getByLabel("回测开始日期", { exact: true }).inputValue(), start);
  await page.getByLabel("ClickHouse 密码", { exact: true }).fill(password);
  await page.getByLabel("重新获取数据", { exact: true }).check();
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
  await page.getByRole("button", { name: "取消加载", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "数据加载已取消" }).waitFor();
  delay = false;
  assert.deepEqual(await inventory(), before);
  await page.getByRole("button", { name: "关闭数据连接", exact: true }).click();
  assert.deepEqual((await exportResult("jsg-clickhouse-preserved.json")).result, first.result);
  await open();
  await page.getByLabel("重新获取数据", { exact: true }).uncheck();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert(await page.getByRole("button", { name: "加载并回测", exact: true }).isVisible());
  await page.screenshot({ path: `${shots}/jsg-clickhouse-mobile.png`, fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    `ClickHouse browser verification PASSED: ${first.result.metrics.days} days; connect, Arrow load, cache, password lifetime, failed refresh, cancel, restore, mobile`,
  );
} catch (error) {
  await page
    .screenshot({ path: `${shots}/jsg-clickhouse-failure.png`, fullPage: true })
    .catch(() => undefined);
  console.error(
    await page
      .locator(".jsg-connection-dialog")
      .innerText()
      .catch(() => "dialog unavailable"),
  );
  throw error;
} finally {
  await browser.close();
}
