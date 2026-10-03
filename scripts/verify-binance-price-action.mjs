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

// Each eight-hour cycle establishes a confirmed 30m high, breaks it with a
// fast advance, retests it through two separate legs, then breaks the full high.
// It is a timing/contract fixture, never evidence of strategy profitability.
function closeAt(index) {
  const cycle = Math.floor(index / 96),
    phase = index - cycle * 96;
  const base = 1000 + cycle * 15;
  if (phase <= 17) return base + (phase * 6) / 17;
  if (phase <= 23) return base + 6 + (phase - 17) / 3;
  if (phase <= 41)
    return (
      base + [6.5, 7, 5.5, 6, 4.5, 5, 3.5, 4, 2.5, 3, 1.5, 2, 0.5, 1, -0.5, 0, -1.5, 0][phase - 24]
    );
  if (phase <= 49) return base + [4, 8, 12, 10.2, 8.4, 10.5, 8.2, 13][phase - 42];
  return base + 13 + ((phase - 49) * 2) / 46;
}
function price(time) {
  const position = (time - (start - day)) / (5 * minute);
  const index = Math.floor(position),
    fraction = position - index;
  return closeAt(index - 1) + (closeAt(index) - closeAt(index - 1)) * fraction;
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
  await settings.getByRole("button", { name: /价格行为.*研究/ }).click();
  assert.equal(await page.getByLabel("交易周期", { exact: true }).inputValue(), "5");
  assert.equal(await page.getByLabel("入场环境", { exact: true }).inputValue(), "slow-ema");
  assert.equal(await page.getByLabel("持仓管理", { exact: true }).inputValue(), "staged");
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
  const result = await exportResult("binance-price-action-result.json");
  assert.equal(result.engine, "trend-continuation-16");
  assert.equal(result.config.version, 10);
  assert.equal(result.config.strategy.entry, "price-action");
  assert.deepEqual(result.config.strategy.priceAction, { keyLevel: true, twoLegs: true });
  const trades = result.chunks.flatMap((chunk) => chunk.trades);
  assert(trades.length > 0, "fixture must exercise the predeclared price-action entry");
  const setupIds = new Set();
  for (const trade of trades) {
    const signal = trade.entrySignal,
      trigger = signal.trigger;
    assert.equal(trigger.kind, "price-action");
    assert.equal(signal.time + 1, trade.entryTime);
    assert.equal((signal.time + 1) % (5 * minute), 0);
    assert(trigger.impulseStartTime < trigger.impulseConfirmedAt);
    assert(trigger.impulseConfirmedAt < trigger.pullbackStartedAt);
    assert(trigger.pullbackStartedAt < signal.time);
    assert.equal(signal.boundary, trigger.impulseExtreme);
    assert(trigger.strengthAtr >= 1.5 && trigger.efficiency >= 0.6);
    assert.equal(trigger.legCount, 2);
    assert(trigger.retracement >= 0.2 && trigger.retracement <= 0.5);
    const level = trigger.keyLevel;
    assert(level.valid && level.retestTime !== undefined);
    assert(level.pivotTime < level.confirmedAt && level.confirmedAt <= trigger.impulseStartTime);
    assert(level.retestTime >= trigger.pullbackStartedAt && level.retestTime <= signal.time);
    assert.equal(level.minutes, 30);
    const direction = trade.side === "long" ? 1 : -1;
    assert(direction * (signal.price - signal.boundary) >= result.config.execution.tickSize - 1e-8);
    assert(!setupIds.has(trigger.setupId), "a setup must not fill repeatedly");
    setupIds.add(trigger.setupId);
  }
  assert(
    Math.abs(
      result.metrics.finalEquity -
        result.config.execution.initialCapital -
        trades.reduce((sum, trade) => sum + trade.netPnl, 0),
    ) < 1e-7,
  );
  await page.getByRole("button", { name: "K 线与买卖点" }).click();
  await page.getByRole("button", { name: `查看交易 ${trades[0].id}`, exact: true }).click();
  const evidence = page.getByRole("region", { name: `交易 ${trades[0].id} 入场依据`, exact: true });
  assert((await evidence.textContent()).includes("推进"));
  assert((await evidence.textContent()).includes("关键位"));
  assert(!(await evidence.textContent()).includes("KDJ"));
  await page.waitForFunction((entry) => {
    const chart = document.querySelector(".trend-chart");
    return (
      document.querySelector('.trend-chart-frame[aria-busy="false"]') &&
      Number(chart?.dataset.candleCount) > 0 &&
      Number(chart?.dataset.visibleFrom) <= entry &&
      Number(chart?.dataset.visibleTo) > entry
    );
  }, trades[0].entryTime);
  await page.screenshot({ path: `${shots}/binance-price-action.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await evidence.scrollIntoViewIfNeeded();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.setViewportSize({ width: 1440, height: 1000 });
  const requests = archives.requestCount();
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".trend-result").waitFor();
  const restored = await exportResult("binance-price-action-restored.json");
  assert.deepEqual(restored.config, result.config);
  assert.deepEqual(restored.metrics, result.metrics);
  assert.equal(archives.requestCount(), requests);
  assert.deepEqual(errors, []);
  console.log(
    `Price-action workflow passed (${trades.length} trades; confirmed levels, two legs, full impulse breakout and restore).`,
  );
} finally {
  await context.close();
  await browser.close();
}
