import assert from "node:assert/strict";
import { ensureShots, launchEphemeralBrowser } from "./lib/browser.mjs";

const url = new URL(process.env.BASE_URL ?? "http://127.0.0.1:5206/");
url.pathname = "/markets";
url.search = "";
const browser = await launchEphemeralBrowser({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const definitions = [
  ["CN:SSE:000001", "sh000001", "上证指数", "CN"],
  ["CN:SSE:000300", "sh000300", "沪深300", "CN"],
  ["CN:SZSE:399006", "sz399006", "创业板", "CN"],
  ["CN:SSE:600519", "sh600519", "贵州茅台", "CN"],
  ["HK:HKEX:00700", "00700", "腾讯控股", "HK"],
  ["US:INDEX:INX", "INX", "标普500", "US"],
];
const snapshot = {
  quotes: definitions.map(([id, sourceSymbol, name, market]) => ({
    instrument: {
      id,
      sourceSymbol,
      name,
      market,
      shortName: name,
      symbol: sourceSymbol.replace(/^(sh|sz)/u, ""),
      venue: market,
      currency: market === "US" ? "USD" : market === "HK" ? "HKD" : "CNY",
      timezone: market === "US" ? "America/New_York" : "Asia/Shanghai",
      assetClass: sourceSymbol === "sh600519" || sourceSymbol === "00700" ? "equity" : "index",
    },
    price: market === "HK" ? 512.5 : market === "US" ? 6_887.35 : 3_442.02,
    change: 1,
    changePercent: 0.84,
    previousClose: 119,
    high: 122,
    low: 118,
    volume: 1_000,
    amount: null,
    sourceTimestamp: null,
    receivedAt: Date.now(),
    quality: "delayed",
    source: "Quote fixture",
    // Reproduce old persisted two-point quotes: cards must ignore these arrays.
    sparkline: [119, 120],
  })),
  futures: [],
  sessions: [],
  feeds: [],
  receivedAt: Date.now(),
  quality: "delayed",
  provider: "Quote fixture",
  errors: [],
};
await context.addInitScript((snapshot) => {
  if (!localStorage.getItem("bcr.market-atlas.snapshot.v1")) {
    localStorage.setItem("bcr.market-atlas.snapshot.v1", JSON.stringify(snapshot));
  }
}, snapshot);

let historyRequests = 0,
  primaryRequests = 0,
  active = 0,
  peak = 0,
  failHistory = false,
  primaryAvailable = false;
const historyCodes = [];
function fixtureKlines(code) {
  const flat = code === "000300";
  const insufficient = code === "399006";
  const missing = code === "600519";
  return missing
    ? []
    : Array.from({ length: insufficient ? 2 : 30 }, (_, index) => {
        // Daily rise and period decline deliberately disagree; chart color follows the period.
        const close = flat ? 100 : 150 - index + (index % 2 ? 4 : -4);
        return `2026-09-${String(index + 1).padStart(2, "0")},${close},${close},${close + 1},${close - 1},1000,100000,1,0,0,1`;
      });
}
await context.route("**/*", async (route) => {
  const request = new URL(route.request().url());
  if (request.pathname === "/api/qt/stock/kline/get") {
    historyRequests++;
    historyCodes.push(request.searchParams.get("secid")?.split(".")[1] ?? "");
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 80));
    try {
      if (failHistory) {
        await route.abort();
        return;
      }
      const code = request.searchParams.get("secid")?.split(".")[1];
      const klines = fixtureKlines(code);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: {
          "access-control-allow-origin": "*",
          "cross-origin-resource-policy": "cross-origin",
        },
        body: JSON.stringify({ data: { name: "History fixture", code, klines } }),
      });
    } finally {
      active--;
    }
  } else if (
    primaryAvailable &&
    /\/appstock\/app\/(usfqkline|fqkline)\/get$/u.test(request.pathname)
  ) {
    primaryRequests++;
    const symbol = request.searchParams.get("param").split(",")[0];
    const code = symbol.replace(/^(sh|sz|hk|us)/u, "");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        code: 0,
        data: { [symbol]: { day: fixtureKlines(code).map((row) => row.split(",")) } },
      }),
    });
  } else if (/eastmoney|sina|sinajs|gtimg|qq\.com|xueqiu|linkdiary/u.test(request.hostname)) {
    await route.abort();
  } else await route.continue();
});

const card = (name) =>
  page.locator(".ma-quote-card").filter({ has: page.locator("b", { hasText: name }) });
try {
  await page.goto(url.toString(), { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelectorAll(".ma-quote-trend").length === 4);
  assert.equal(historyRequests, 6, "Load only one month per visible asset");
  assert(peak <= 3, `History concurrency must be bounded; observed ${peak}`);
  const curve = await card("上证指数").locator(".ma-quote-trend path").getAttribute("d");
  assert.equal((curve.match(/L/gu) ?? []).length, 19, "Render 20 actual closing prices");
  assert(new Set([...curve.matchAll(/,([\d.]+)/gu)].map((match) => match[1])).size > 3);
  assert.equal(
    await card("上证指数").locator(".ma-quote-trend path").getAttribute("stroke"),
    "var(--color-danger)",
  );
  assert((await card("上证指数").innerText()).includes("近20日"));
  assert(
    (await card("上证指数").locator(".ma-quote-trend").getAttribute("aria-label")).includes(
      "2026-09-11 至 2026-09-30",
    ),
  );
  const flat = await card("沪深300").locator(".ma-quote-trend path").getAttribute("d");
  assert(
    [...flat.matchAll(/,([\d.]+)/gu)].every((match) => Number(match[1]) === 27),
    "Flat real prices must stay centered",
  );
  for (const name of ["创业板", "贵州茅台"]) {
    assert.equal(
      await card(name).locator(".ma-quote-main svg").count(),
      0,
      "Never replace unavailable history with a two-point or simulated curve",
    );
    assert((await card(name).innerText()).includes("暂无走势"));
  }
  await page.getByRole("button", { name: "刷新行情", exact: true }).click();
  await page.locator(".ma-refresh:not(:disabled)").waitFor();
  assert.equal(
    historyRequests,
    6,
    "Quote refresh must reuse the history cache and failure backoff",
  );
  await page.getByRole("button", { name: "HK", exact: true }).click();
  await card("腾讯控股").waitFor();
  await page.waitForFunction(() => document.querySelectorAll(".ma-quote-trend").length === 1);
  assert.equal(historyRequests, 6, "Region switching must reuse loaded history");
  await page.getByRole("button", { name: "全部", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll(".ma-quote-trend").length === 4);
  await page.screenshot({ path: `${ensureShots()}/market-trends.png`, fullPage: true });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    const graph = await card("上证指数").locator(".ma-quote-trend").boundingBox();
    const change = await card("上证指数").locator(".ma-quote-main em").boundingBox();
    const label = await card("上证指数").locator(".ma-quote-trend > span").boundingBox();
    const bounds = await card("上证指数").boundingBox();
    assert(graph.y >= change.y + change.height, "Mobile graph must not overlap price/change");
    assert(label.height <= 16, "Period label must remain on one line");
    assert(label.x + label.width <= bounds.x + bounds.width, "Period label must fit the card");
  }
  await page.screenshot({ path: `${ensureShots()}/market-trends-mobile.png`, fullPage: true });

  // Fresh cache is useful after reload even when the historical upstream is offline.
  failHistory = true;
  historyCodes.length = 0;
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelectorAll(".ma-quote-trend").length === 4);
  assert((await card("上证指数").innerText()).includes("缓存"));
  assert.equal(await card("上证指数").locator(".ma-quote-trend path").getAttribute("d"), curve);
  assert.deepEqual(
    [...new Set(historyCodes)].sort((a, b) => a.localeCompare(b)),
    ["399006", "600519"],
    "Fresh real curves survive reload; only previously empty assets retry",
  );

  // Expired real history remains available on failure without changing its original date.
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage).filter((key) =>
      key.startsWith("bcr.market-atlas.trend.v1:"),
    )) {
      const value = JSON.parse(localStorage.getItem(key));
      value.storedAt -= 2 * 60 * 60_000;
      localStorage.setItem(key, JSON.stringify(value));
    }
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelectorAll(".ma-quote-trend").length === 4);
  assert.equal(await card("上证指数").locator(".ma-quote-trend path").getAttribute("d"), curve);
  assert(
    (await card("上证指数").locator(".ma-quote-trend").getAttribute("aria-label")).includes(
      "2026-09-30",
    ),
  );
  // Prefer the fast real primary series; secondary SDK history only runs for missing assets.
  failHistory = false;
  primaryAvailable = true;
  const secondaryBefore = historyRequests;
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage).filter((key) =>
      key.startsWith("bcr.market-atlas.trend.v1:"),
    )) {
      localStorage.removeItem(key);
    }
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelectorAll(".ma-quote-trend").length === 4);
  assert.equal(primaryRequests, 6, "Primary daily prices cover all visible assets");
  assert.equal(
    historyRequests,
    secondaryBefore + 2,
    "Only two missing primary series require fallback",
  );
  assert(
    (await card("上证指数").locator(".ma-quote-trend").getAttribute("aria-label")).includes("腾讯"),
  );
  assert.equal(await card("上证指数").locator(".ma-quote-trend path").getAttribute("d"), curve);
  assert.deepEqual(errors, []);
  console.log(
    "Market trend verification passed: real 20-session closes, source failover, bounded loading, honest empty states, flat prices, period color, refresh caching, offline reload and mobile.",
  );
} finally {
  await context.close();
  await browser.close();
}
