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
const page = await context.newPage(),
  errors = [];
page.on("pageerror", (error) => errors.push(error.message));
// Synthetic causal two-leg fixture. It tests execution/serialization/display,
// never profitability. The key-level gate is explicitly disabled for this case.
function closeAt(index) {
  const cycle = Math.floor(index / 48),
    phase = index - cycle * 48;
  const base = 1000 + cycle * 8;
  if (phase <= 20) return base + 0.2 * Math.sin(phase);
  const pullback = [
    2, 4, 6, 4.7, 4.3, 4.1, 4.4, 4.8, 5.1, 5.3, 4.9, 4.5, 4.2, 4.1, 4.5, 4.9, 5.1, 6.8,
  ];
  if (phase <= 38) return base + pullback[phase - 21];
  return base + 6.8 + (phase - 38) * 0.07;
}
function price(time) {
  const position = (time - (start - 4 * day)) / (30 * minute);
  const index = Math.floor(position),
    fraction = position - index;
  return closeAt(index - 1) + (closeAt(index) - closeAt(index - 1)) * fraction;
}
const archives = await installTrendArchives(context, { start, price });
async function exportResult(name) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出完整结果" }).click();
  const path = `${shots}/${name}`;
  await (await pending).saveAs(path);
  return JSON.parse(readFileSync(path, "utf8"));
}
try {
  await page.goto(`${baseOrigin()}/quant?strategy=trend`, { waitUntil: "networkidle" });
  await page.getByLabel("Binance 开始日期").fill("2024-01-01");
  await page.getByLabel("Binance 结束日期").fill("2024-01-03");
  await page.getByRole("button", { name: "趋势参数设置" }).click();
  const settings = page.getByRole("dialog", { name: "趋势研究设置" });
  await settings.getByRole("button", { name: /结构化回调研究/ }).click();
  assert.equal(await page.getByLabel("交易周期", { exact: true }).inputValue(), "30");
  assert.equal(await page.getByLabel("持仓管理", { exact: true }).inputValue(), "chandelier");
  assert.equal(await page.getByLabel("入场环境", { exact: true }).inputValue(), "ema");
  assert.equal(await page.getByLabel("关键位要求").inputValue(), "either");
  assert.equal(await page.getByLabel("回调结构要求").inputValue(), "any");
  assert.equal(await page.getByLabel("结构确认时点").inputValue(), "before-breakout");
  assert.equal(await page.getByLabel("关键位用途").inputValue(), "pullback-retest");
  await page.getByLabel("结构确认时点").selectOption("signal-close");
  await page.getByLabel("关键位用途").selectOption("impulse-context");
  await page.getByLabel("关键位要求").selectOption("none");
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
  const result = await exportResult("binance-structured-result.json");
  assert.equal(result.engine, "trend-continuation-16");
  assert.equal(result.config.version, 10);
  assert.deepEqual(result.config.strategy.structuredPullback, {
    keyLevel: "none",
    shape: "any",
    candle: "none",
    confirmation: "signal-close",
    keyRole: "impulse-context",
  });
  assert.equal(result.config.strategy.management, "chandelier");
  assert.equal(result.config.strategy.filter, "ema");
  assert.equal(result.config.risk.dailyLossPct, 0);
  assert.equal(result.config.strategy.breakEvenAtr, 0);
  assert.equal(result.config.strategy.staged, undefined);
  const trades = result.chunks.flatMap((chunk) => chunk.trades);
  assert(trades.length > 0, "fixture must execute confirmed structured pullbacks");
  const setups = new Set();
  for (const trade of trades) {
    const signal = trade.entrySignal,
      trigger = signal.trigger;
    assert.equal(trigger.kind, "structured-pullback");
    assert.equal(trigger.confirmation, "signal-close");
    assert.equal(trigger.keyRole, "impulse-context");
    assert.deepEqual(trigger.gates, { retracement: true, key: true, shape: true, candle: true });
    assert.equal(typeof trigger.contextEligible.pivot, "boolean");
    assert.equal(typeof trigger.contextEligible.ema, "boolean");
    assert.equal(signal.time + 1, trade.entryTime);
    assert(trigger.impulseEndTime < trigger.pullbackStartedAt);
    assert.equal(signal.boundary, trigger.impulseExtreme);
    assert(Object.values(trigger.shapes).some(Boolean));
    assert(
      trigger.turns.every(
        (turn) => turn.time < turn.confirmedAt && turn.confirmedAt <= signal.time,
      ),
    );
    assert(!setups.has(trigger.setupId));
    setups.add(trigger.setupId);
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
  assert((await evidence.textContent()).includes("已确认回调结构"));
  assert((await evidence.textContent()).includes("推进"));
  assert((await evidence.textContent()).includes("允许突破 K 线收盘确认"));
  assert((await evidence.textContent()).includes("推进背景 · 不要求本次回踩"));
  assert((await evidence.textContent()).includes("并行门槛"));
  await page.waitForFunction((entry) => {
    const chart = document.querySelector(".trend-chart");
    return (
      document.querySelector('.trend-chart-frame[aria-busy="false"]') &&
      Number(chart?.dataset.candleCount) > 0 &&
      Number(chart?.dataset.visibleFrom) <= entry &&
      Number(chart?.dataset.visibleTo) > entry
    );
  }, trades[0].entryTime);
  await page.screenshot({ path: `${shots}/binance-structured.png`, fullPage: true });
  await evidence.screenshot({ path: `${shots}/binance-structured-evidence.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await evidence.scrollIntoViewIfNeeded();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: `${shots}/binance-structured-mobile.png`, fullPage: true });
  const requests = archives.requestCount();
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".trend-result").waitFor();
  const restored = await exportResult("binance-structured-restored.json");
  assert.deepEqual(restored.config, result.config);
  assert.deepEqual(restored.metrics, result.metrics);
  assert.equal(archives.requestCount(), requests);
  await page.getByRole("button", { name: "趋势参数设置" }).click();
  assert.equal(await page.getByLabel("结构确认时点").inputValue(), "signal-close");
  assert.equal(await page.getByLabel("关键位用途").inputValue(), "impulse-context");
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.getByLabel("结构确认时点").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `${shots}/binance-structured-settings-mobile.png`,
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    `Structured pullback workflow passed (${trades.length} synthetic trades; confirmed shapes, next-open execution and restore).`,
  );
} finally {
  await context.close();
  await browser.close();
}
