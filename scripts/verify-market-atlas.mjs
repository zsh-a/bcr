/* Market Atlas：全市场扫描 → 板块/排行 → 搜索/股息 → 历史 K 线 → Quant 交接。 */
import { launchVerifyBrowser } from "./verify-browser.mjs";

const base = new URL(process.env.BASE_URL ?? "http://localhost:5199/studio");
base.pathname = "/markets";
base.search = "";
const dir = new URL("./shots/", import.meta.url).pathname;
const fail = (message) => {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
};

const browser = await launchVerifyBrowser("studio");
const page = browser.pages()[0] ?? (await browser.newPage());
page.on("pageerror", (error) => fail(`pageerror: ${error.message}`));

await page.goto(base.toString(), { waitUntil: "domcontentloaded" });
await page.locator(".market-atlas").waitFor({ timeout: 20_000 });
await page.locator(".ma-refresh:not(:disabled)").waitFor({ timeout: 45_000 });

const body = await page.locator("body").innerText();
if (!body.includes("Market Atlas") || !body.includes("Markets never move")) {
  fail("Market Atlas 主界面未渲染");
}
if ((await page.locator(".ma-session").count()) !== 4) fail("全球市场时区轨道不完整");
if ((await page.locator(".ma-quote-card").count()) < 3) fail("市场脉搏数据不足");
if ((await page.locator(".ma-sector-map > button").count()) < 8) fail("行业热图数据不足");
if ((await page.locator(".ma-market-ranking > button").count()) !== 8) {
  fail("全市场排行未完整渲染");
}
const universe = Number(
  (
    await page.locator(".ma-market-breadth-strip > div").first().locator("b").innerText()
  ).replaceAll(",", ""),
);
if (!Number.isFinite(universe) || universe < 5_000) fail("A 股全市场广度未加载");
await page.locator("[data-dividend-ledger]").waitFor({ timeout: 30_000 });
const initialIncome = await page.locator("[data-dividend-ledger]").innerText();
if (
  (await page.locator(".ma-hero-grid [data-dividend-ledger]").count()) !== 1 ||
  !/(A-SHARE REFERENCE ONLINE|CACHED REFERENCE|DEMO REFERENCE)/.test(initialIncome) ||
  (await page.locator(".ma-dividend-timeline article").count()) < 1
) {
  fail("默认焦点未展示股息账本");
}
await page.getByRole("button", { name: "TURNOVER", exact: true }).click();
const firstRank = page.locator(".ma-market-ranking > button").first();
const rankedSymbol = (await firstRank.locator("span small").innerText()).split(" · ")[0];
await firstRank.click();
await page.waitForFunction(
  (symbol) => document.querySelector(".ma-focus-copy .ma-symbol")?.textContent?.includes(symbol),
  rankedSymbol,
  { timeout: 20_000 },
);
if (!body.includes("Source integrity") || !body.includes("informational use only")) {
  fail("数据质量与延迟声明缺失");
}

await page.getByRole("button", { name: "HK", exact: true }).click();
const hkCards = page.locator(".ma-quote-card");
if ((await hkCards.count()) < 1) fail("HK 市场筛选无结果");
await hkCards.first().locator(".ma-quote-main").click();
await page.locator(".ma-open-quant:not(:disabled)").waitFor({ timeout: 45_000 });
if ((await page.locator(".ma-candle-chart .body").count()) < 20) {
  fail("历史 K 线未渲染");
}

const firstStar = hkCards.first().locator(".ma-card-star");
const wasWatched = await firstStar.evaluate((element) => element.classList.contains("watched"));
await firstStar.click();
if ((await firstStar.evaluate((element) => element.classList.contains("watched"))) === wasWatched) {
  fail("Watchlist 交互未生效");
}
const watchlistGroups = page.locator(".ma-watchlist-groups [role=tab]");
if ((await watchlistGroups.count()) < 2) fail("Watchlist 分组未渲染");
await watchlistGroups.nth(1).click();
const groupSend = page.getByRole("button", { name: "SEND GROUP", exact: true });
await groupSend.waitFor({ timeout: 10_000 });
await Promise.all([
  page.waitForURL((url) => url.pathname === "/quant", {
    timeout: 30_000,
    waitUntil: "commit",
  }),
  groupSend.click(),
]);
await page.locator(".ql-handoff-block").waitFor({ timeout: 60_000 });
const handoffSeriesCount = await page
  .locator(".ql-handoff-block")
  .getAttribute("data-series-count");
if (Number(handoffSeriesCount) < 3) {
  fail(`多标的 handoff 序列数量错误: ${handoffSeriesCount ?? "missing"}`);
}
if (!(await page.locator(".ql-market-status").innerText()).includes("MARKET ATLAS")) {
  fail("Quant Lab 未显示 Market Atlas 多序列状态");
}
await page.locator("[data-portfolio-analysis]").waitFor({ timeout: 60_000 });
if ((await page.locator("[data-correlation-matrix] tbody tr").count()) < 3) {
  fail("Quant Lab 组合相关性矩阵未覆盖多标的");
}
if (!(await page.locator("[data-portfolio-metrics]").innerText()).includes("EQUAL-WEIGHT")) {
  fail("Quant Lab 等权组合基准未渲染");
}
await page.reload({ waitUntil: "domcontentloaded" });
await page.locator(".ql-handoff-block").waitFor({ timeout: 60_000 });
await page.locator("[data-portfolio-analysis]").waitFor({ timeout: 60_000 });
await page.goto(base.toString(), { waitUntil: "domcontentloaded" });
await page.locator(".market-atlas").waitFor({ timeout: 20_000 });
await page.locator(".ma-refresh:not(:disabled)").waitFor({ timeout: 45_000 });

const search = page.getByLabel("Search global instruments");
await search.fill("茅台");
await page.locator(".ma-search-results > button").first().waitFor({ timeout: 20_000 });
await page.locator(".ma-search-results > button").first().click();
await page.waitForFunction(
  () => document.querySelector(".ma-focus-copy h2")?.textContent?.includes("贵州茅台"),
  undefined,
  { timeout: 20_000 },
);
await page.locator(".ma-dividend-timeline article").first().waitFor({ timeout: 30_000 });
const incomeText = await page.locator(".ma-corporate-section").innerText();
if (!incomeText.includes("A-SHARE REFERENCE ONLINE") || !incomeText.includes("CNY / 10 SHARES")) {
  fail("A 股股息与公司行动未渲染");
}
await page.locator(".ma-open-quant:not(:disabled)").waitFor({ timeout: 45_000 });

await page.screenshot({ path: `${dir}/market-atlas.png`, fullPage: true });
await Promise.all([
  page.waitForURL((url) => url.pathname === "/quant", {
    timeout: 30_000,
    waitUntil: "commit",
  }),
  page.locator(".ma-open-quant").click(),
]);
try {
  await page.waitForFunction(
    () => document.querySelector(".ql-market-status")?.textContent?.includes("MARKET ATLAS"),
    undefined,
    { timeout: 45_000 },
  );
} catch (error) {
  console.error(`Market handoff diagnostics:\n${await page.locator("body").innerText()}`);
  throw error;
}
await page.getByRole("button", { name: "RUN BACKTEST" }).waitFor({ timeout: 30_000 });
const quantBody = await page.locator("body").innerText();
if (!quantBody.includes("daily bars from Market Atlas")) fail("Quant Lab 未记录市场数据交接");

await browser.close();
console.log(
  process.exitCode ? "market atlas verification FAILED" : "market atlas verification PASSED",
);
