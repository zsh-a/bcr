import assert from "node:assert/strict";
import { ensureShots, launchEphemeralBrowser } from "./lib/browser.mjs";
const url = new URL(process.env.BASE_URL ?? "http://127.0.0.1:5206/");
url.pathname = "/markets";
url.search = "";
const browser = await launchEphemeralBrowser({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage(),
  errors = [],
  shots = ensureShots();
page.on("pageerror", (e) => errors.push(e.message));
// Deterministic offline quotes exercise labelled fallback and don't depend on market hours.
await context.route("**/*", async (route) => {
  const request = new URL(route.request().url());
  if (/eastmoney|sina|sinajs|gtimg|qq\.com|xueqiu/u.test(request.hostname)) await route.abort();
  else await route.continue();
});
try {
  await page.goto(url.toString(), { waitUntil: "networkidle" });
  await page.locator(".ma-overview-summary").waitFor();
  assert.equal(await page.locator(".ma-view-nav button").count(), 4);
  assert((await page.locator(".ma-header").boundingBox()).height <= 64);
  assert.equal(
    await page.locator(".ma-candle-chart").count(),
    0,
    "Overview must not render the detailed candlestick chart",
  );
  assert.equal(await page.locator("[data-dividend-ledger]").count(), 0);
  assert((await page.locator(".ma-data-stamp.demo").count()) > 0, "Demo source must be explicit");
  await page.getByRole("button", { name: "行业", exact: true }).click();
  assert.equal(new URL(page.url()).searchParams.get("view"), "sectors");
  assert.equal(
    await page.locator(".ma-sector-map button:disabled").count(),
    0,
    "Industry exploration must not depend on a leader",
  );
  await page.locator(".ma-sector-map button").first().click();
  await page.locator(".ma-sector-detail[open]").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "宽度", exact: true }).click();
  await page.getByRole("heading", { name: "历史行业宽度", exact: true }).waitFor();
  assert((await page.locator(".ma-content").innerText()).includes("无需先运行回测"));
  await page.getByRole("button", { name: "自选", exact: true }).click();
  await page.getByRole("button", { name: "新建分组", exact: true }).click();
  await page.getByLabel("分组名称", { exact: true }).fill("行业研究");
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await page.getByRole("heading", { name: "开始整理你的研究标的", exact: true }).waitFor();
  await page.getByRole("button", { name: "概览", exact: true }).click();
  await page.locator(".ma-quote-card .ma-card-star").first().click();
  await page.locator(".ma-quote-main").first().click();
  await page.locator(".ma-stock-detail[open]").waitFor();
  await page.locator(".ma-candle-chart").waitFor();
  const dialogBox = await page.locator(".ma-stock-detail").boundingBox();
  assert(dialogBox.x > 100 && dialogBox.y > 0, "Stock detail must use centered shared dialog");
  await page.getByRole("button", { name: "使用此行情研究 SMA", exact: true }).click();
  await page
    .locator(".ql-handoff-block, .ql-boot-error")
    .first()
    .waitFor({ timeout: 60000, state: "attached" });
  assert.equal(
    await page.locator(".ql-boot-error").count(),
    0,
    await page.locator("body").innerText(),
  );
  assert.equal(new URL(page.url()).pathname, "/quant");
  assert.equal(await page.locator(".ql-research-shell").getAttribute("data-strategy"), "sma");
  assert.equal(
    await page.evaluate(() => localStorage.getItem("bcr.market.quant-reference.v1")),
    null,
    "Reference acknowledged after import",
  );
  assert.equal(
    await page.evaluate(() => localStorage.getItem("bcr.market-atlas.quant-handoff.v2")),
    null,
    "No bar arrays in localStorage handoff",
  );
  await page.getByLabel("选择策略", { exact: true }).selectOption("jsg");
  await page.locator(".research-run-button:not(:disabled)").waitFor({ timeout: 60000 });
  await page.getByRole("button", { name: "运行回测", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector(".research-status")?.textContent.includes("回测完成"),
    null,
    { timeout: 60000 },
  );
  await page.getByRole("tab", { name: "选股解释", exact: true }).click();
  await page.locator(".ui-breadth-table button").first().waitFor();
  await page.getByRole("button", { name: "在 Market 查看", exact: true }).click();
  await page
    .locator(".ma-breadth-view .ui-breadth-table button")
    .first()
    .waitFor({ timeout: 60000 });
  assert(new URL(page.url()).searchParams.get("snapshot"));
  assert((await page.locator(".ma-breadth-view").innerText()).includes("科技"));
  await page.locator(".ma-breadth-view .ui-breadth-table button").first().click();
  assert((await page.locator(".ma-breadth-inspector").innerText()).includes("高于 MA20"));
  await page.screenshot({ path: `${shots}/market-breadth.png`, fullPage: true });
  const reference = new URL(page.url()).searchParams.get("snapshot");
  await page.reload({ waitUntil: "networkidle" });
  await page
    .locator(".ma-breadth-view .ui-breadth-table button")
    .first()
    .waitFor({ timeout: 60000 });
  assert.equal(new URL(page.url()).searchParams.get("snapshot"), reference);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    const bounds = await page.locator(".ma-header").boundingBox();
    assert(bounds.height <= 110);
    await page.getByRole("button", { name: "行业", exact: true }).click();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await page.getByRole("button", { name: "自选", exact: true }).click();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
  }
  await page.screenshot({ path: `${shots}/market-mobile.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "宽度", exact: true }).click();
  await page.getByLabel("选择冻结数据快照", { exact: true }).selectOption(reference);
  await page
    .locator(".ma-breadth-view .ui-breadth-table button")
    .first()
    .waitFor({ timeout: 60000 });
  await page.getByRole("button", { name: "在 Quant 研究", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector(".research-status")?.textContent.includes("已载入 Market 冻结快照"),
    null,
    { timeout: 60000 },
  );
  assert.equal(
    await page.locator(".ql-research-shell").getAttribute("data-strategy"),
    "jsg",
    "Kept-alive app must respond to strategy query",
  );
  assert.equal(
    new URL(page.url()).searchParams.get("snapshot"),
    null,
    "URL acknowledged only after successful dataset import",
  );
  assert.deepEqual(errors, []);
  console.log(
    "Market architecture browser verification passed: navigation, sectors, lazy details, OPFS handoff, Rust breadth, frozen round trip, reload and mobile.",
  );
} catch (error) {
  console.error(
    "Market test failed at",
    page.url(),
    "body:",
    await page.locator("body").innerText(),
    "page errors:",
    errors,
  );
  throw error;
} finally {
  await context.close();
  await browser.close();
}
