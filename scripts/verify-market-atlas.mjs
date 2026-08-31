/* Market Atlas：数据质量 → 市场筛选 → 历史 K 线 → Watchlist → Quant 交接。 */
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

await page.screenshot({ path: `${dir}/market-atlas.png`, fullPage: true });
await page.locator(".ma-open-quant").click();
await page.waitForURL((url) => url.pathname === "/quant", { timeout: 15_000 });
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
