import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { baseOrigin, ensureShots, launchEphemeralBrowser } from "./lib/browser.mjs";

import { installTrendArchives } from "./lib/trend-browser-fixture.mjs";

const start = Date.UTC(2024, 0, 1),
  minute = 60_000,
  day = 86_400_000;
const shots = ensureShots();
const browser = await launchEphemeralBrowser({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

// Repeated pullbacks within an established trend exercise low-zone arming,
// a later K/D cross, and both protection activation thresholds.
function price(time) {
  const bars = (time - (start - day)) / (5 * minute);
  const cycle = Math.floor(bars / 50),
    phase = bars - cycle * 50;
  const movement =
    phase <= 30 ? phase * 0.8 : phase <= 38 ? 24 - (phase - 30) : 16 + (phase - 38) * 0.5;
  return 1000 + cycle * 22 + movement;
}
const archives = await installTrendArchives(context, { start, price });
async function exportResult(name) {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出完整结果" }).click();
  const path = `${shots}/${name}`;
  await (await download).saveAs(path);
  return JSON.parse(readFileSync(path, "utf8"));
}
try {
  await page.goto(`${baseOrigin()}/quant?strategy=trend`, { waitUntil: "networkidle" });
  await page.getByLabel("Binance 开始日期").fill("2024-01-01");
  await page.getByLabel("Binance 结束日期").fill("2024-01-03");
  await page.getByRole("button", { name: "趋势参数设置" }).click();
  const settings = page.getByRole("dialog", { name: "趋势研究设置" });
  await settings.getByRole("button", { name: /KDJ.*研究/ }).click();
  assert.equal(await page.getByLabel("交易周期", { exact: true }).inputValue(), "5");
  assert.equal(await page.getByLabel("持仓管理", { exact: true }).inputValue(), "staged");
  assert.equal(await page.getByLabel("入场环境", { exact: true }).inputValue(), "slow-ema");
  await settings.getByRole("button", { name: "应用设置", exact: true }).click();
  await page.getByRole("button", { name: /^(获取并回测|运行回测)$/ }).click();
  await page.waitForFunction(
    () => document.querySelector(".trend-result") || document.querySelector(".trend-error"),
    null,
    { timeout: 120000 },
  );
  assert.equal(
    await page.locator(".trend-error").count(),
    0,
    (await page.locator(".trend-error").allTextContents()).join("\n"),
  );
  const result = await exportResult("binance-kdj-result.json");
  assert.equal(result.engine, "trend-continuation-16");
  assert.equal(result.config.version, 10);
  assert.equal(result.config.strategy.entry, "kdj");
  assert.deepEqual(result.config.strategy.staged, { breakEvenR: 1, trailingStartR: 2 });
  const trades = result.chunks.flatMap((chunk) => chunk.trades);
  const events = result.chunks.flatMap((chunk) => chunk.events);
  assert(trades.length > 0, "fixture must exercise KDJ entries");
  assert(events.some((event) => event.reason === "breakeven-armed"));
  assert(events.some((event) => event.reason === "trailing-armed"));
  for (const trade of trades) {
    const signal = trade.entrySignal;
    assert.equal(signal.time, trade.entryTime - 1);
    assert.equal((signal.time + 1) % (5 * minute), 0);
    assert.equal(signal.trigger.kind, "kdj-cross");
    assert.equal(signal.boundary, undefined, "KDJ entry must not invent a price breakout");
    assert(signal.trigger.armedAt < signal.time);
    assert.equal(signal.trigger.j, 3 * signal.trigger.k - 2 * signal.trigger.d);
    assert(
      trade.side === "long"
        ? signal.trigger.previousK <= signal.trigger.previousD &&
            signal.trigger.k > signal.trigger.d
        : signal.trigger.previousK >= signal.trigger.previousD &&
            signal.trigger.k < signal.trigger.d,
    );
  }
  assert(
    Math.abs(
      result.metrics.finalEquity -
        result.config.execution.initialCapital -
        trades.reduce((sum, trade) => sum + trade.netPnl, 0),
    ) < 1e-7,
  );
  await page.getByRole("button", { name: "K 线与买卖点" }).click();
  await page.locator(".trend-chart canvas").first().waitFor();
  await page.getByRole("button", { name: `查看交易 ${trades[0].id}`, exact: true }).click();
  const evidence = page.getByRole("region", { name: `交易 ${trades[0].id} 入场依据`, exact: true });
  assert((await evidence.textContent()).includes("KDJ"));
  assert(!(await evidence.textContent()).includes("突破幅度"));
  await page.waitForFunction((entry) => {
    const chart = document.querySelector(".trend-chart");
    return (
      document.querySelector('.trend-chart-frame[aria-busy="false"]') &&
      Number(chart?.dataset.candleCount) > 0 &&
      Number(chart?.dataset.stopSegments) > 0 &&
      Number(chart?.dataset.visibleFrom) <= entry &&
      Number(chart?.dataset.visibleTo) > entry
    );
  }, trades[0].entryTime);
  assert.equal(await page.locator(".trend-chart-error").count(), 0);
  assert(await page.getByText("K / D / J · 9,3,3 · 下方面板", { exact: true }).isVisible());
  await page.screenshot({ path: `${shots}/binance-kdj.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await evidence.scrollIntoViewIfNeeded();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.setViewportSize({ width: 1440, height: 1000 });
  const fetched = archives.requestCount();
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".trend-result").waitFor();
  const restored = await exportResult("binance-kdj-restored.json");
  assert.deepEqual(restored.config, result.config);
  assert.deepEqual(restored.metrics, result.metrics);
  assert.equal(
    archives.requestCount(),
    fetched,
    "restoring research must use frozen local artifacts",
  );
  assert.deepEqual(errors, []);
  console.log(
    `KDJ research workflow passed (${trades.length} trades; staged protection, evidence and restore).`,
  );
} finally {
  await context.close();
  await browser.close();
}
