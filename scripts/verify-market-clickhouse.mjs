import assert from "node:assert/strict";
import { ensureShots, launchEphemeralBrowser } from "./lib/browser.mjs";
const url = new URL(process.env.BASE_URL ?? "http://127.0.0.1:5206/");
url.pathname = "/markets";
url.search = "?view=breadth";
const source = process.env.CLICKHOUSE_TEST_URL ?? "http://127.0.0.1:8128/";
const browser = await launchEphemeralBrowser({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage(),
  errors = [];
let sourceRequests = 0;
page.on("request", (request) => {
  if (request.url().startsWith(source)) sourceRequests++;
});
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(url.toString(), { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "连接 ClickHouse", exact: true }).click();
  await page.getByLabel("HTTP 地址", { exact: true }).fill(source);
  await page.getByLabel("数据库", { exact: true }).fill("stock_data");
  await page.getByLabel("用户", { exact: true }).fill("fixture");
  await page.getByLabel("密码", { exact: true }).fill("fixture-secret-do-not-persist");
  await page.getByRole("button", { name: "检查连接", exact: true }).click();
  await page.getByLabel("开始日期", { exact: true }).fill("2024-02-13");
  await page.getByLabel("结束日期", { exact: true }).fill("2024-08-30");
  await page.getByRole("button", { name: "加载并分析", exact: true }).click();
  await page
    .locator(".ma-breadth-view .ui-breadth-table button")
    .first()
    .waitFor({ timeout: 60000 });
  const reference = new URL(page.url()).searchParams.get("snapshot");
  assert(reference);
  assert((await page.locator(".ma-breadth-view").innerText()).includes("快照成员"));
  assert(
    (await page.locator(".ui-breadth-table th").allTextContents()).some(
      (t) => /[\u4e00-\u9fff]/u.test(t) && t !== "行业",
    ),
  );
  const profile = await page.evaluate(() =>
    localStorage.getItem("bcr.market.clickhouse-profile.v1"),
  );
  assert(profile.includes(source));
  assert(!profile.includes("fixture-secret-do-not-persist"));
  assert(!profile.includes("password"));
  await page.screenshot({ path: `${ensureShots()}/market-clickhouse.png`, fullPage: true });
  const count = sourceRequests;
  await page.reload({ waitUntil: "networkidle" });
  await page
    .locator(".ma-breadth-view .ui-breadth-table button")
    .first()
    .waitFor({ timeout: 60000 });
  assert.equal(
    sourceRequests,
    count,
    "Reload must reuse frozen OPFS snapshot and cached breadth without re-reading ClickHouse",
  );
  await page.getByRole("button", { name: "在 Quant 研究", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector(".research-status")?.textContent.includes("已载入 Market 冻结快照"),
    null,
    { timeout: 60000 },
  );
  assert.equal(new URL(page.url()).pathname, "/quant");
  assert.equal(new URL(page.url()).searchParams.get("strategy"), "jsg");
  assert.equal(sourceRequests, count, "Quant intake must not download the dataset again");
  assert.deepEqual(errors, []);
  console.log(
    `Market ClickHouse browser verification passed: ${count} readonly HTTP requests, Rust daily breadth, Chinese labels, frozen reload, secret-free profile and reference intake.`,
  );
} catch (e) {
  console.error(page.url(), await page.locator("body").innerText(), errors);
  throw e;
} finally {
  await context.close();
  await browser.close();
}
