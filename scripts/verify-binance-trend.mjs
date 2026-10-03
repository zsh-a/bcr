import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { baseOrigin, ensureShots, launchEphemeralBrowser } from "./lib/browser.mjs";

const { TextReader, Uint8ArrayWriter, ZipWriter } = createRequire(
  new URL("../packages/market-data/package.json", import.meta.url),
)("@zip.js/zip.js");

const origin = baseOrigin(),
  shots = ensureShots();
const live = process.env.BINANCE_LIVE === "1";
const researchDays = live ? 1 : 3;
const archiveRequests = 2 * (researchDays + 1) + 1;
const browser = await launchEphemeralBrowser({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
});
const page = await context.newPage(),
  errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const archives = new Map();
let requests = 0,
  corrupt = false;
const start = Date.UTC(2024, 0, 1),
  minute = 60000,
  day = 86400000;
async function archive(url) {
  if (archives.has(url)) return archives.get(url);
  let csv;
  if (url.includes("fundingRate")) {
    csv =
      "calc_time,funding_interval_hours,last_funding_rate\n" +
      Array.from(
        { length: 93 },
        (_, i) => `${start + i * 8 * 60 * minute + 1},8,${i % 2 ? -0.0001 : 0.0001}`,
      ).join("\n");
  } else {
    const date = url.match(/(\d{4}-\d{2}-\d{2})\.zip$/)?.[1];
    assert(date, url);
    const from = Date.parse(`${date}T00:00:00Z`);
    let previous = 1000;
    const changes = [1, 1, 1, -0.6, -0.15, 1, 0.4, 0.5, 0.3, 0.2];
    csv = Array.from({ length: 1440 }, (_, i) => {
      const time = from + i * minute;
      const elapsed = (time - (start - day)) / minute;
      const cycle = Math.max(0, elapsed - 1440);
      const close =
        elapsed < 1440
          ? 1000 + (elapsed + 1) * 0.02
          : 1028.8 +
            Math.floor(cycle / 30) * 4.05 +
            changes.slice(0, Math.min((cycle % 30) + 1, 10)).reduce((a, b) => a + b, 0) +
            Math.max(0, (cycle % 30) - 9) * 0.02;
      const open = i === 0 ? close - 0.02 : previous;
      previous = close;
      return `${time},${open},${Math.max(open, close) + 0.05},${Math.min(open, close) - 0.05},${close},10,${time + 59999},0,1,0,0,0`;
    }).join("\n");
  }
  const zip = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false });
  await zip.add("history.csv", new TextReader(csv), { level: 0 });
  const bytes = Buffer.from(await zip.close());
  const entry = { bytes, hash: createHash("sha256").update(bytes).digest("hex") };
  archives.set(url, entry);
  return entry;
}
if (!live)
  await context.route("https://data.binance.vision/**", async (route) => {
    const url = route.request().url(),
      checksum = url.endsWith(".CHECKSUM");
    const data = await archive(checksum ? url.slice(0, -9) : url);
    if (!checksum) requests++;
    await route.fulfill({
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": checksum ? "text/plain" : "application/zip",
      },
      body: checksum ? `${corrupt ? "0".repeat(64) : data.hash}  history.zip` : data.bytes,
    });
  });
const runButton = () => page.getByRole("button", { name: /^(获取并回测|运行回测)$/ });
const exportResult = async (name) => {
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出完整结果" }).click();
  const file = `${shots}/${name}`;
  await (await event).saveAs(file);
  return JSON.parse(readFileSync(file, "utf8"));
};
try {
  await page.goto(`${origin}/quant?strategy=trend`, { waitUntil: "networkidle" });
  await page.getByLabel("Binance 开始日期").fill("2024-01-01");
  await page.getByLabel("Binance 结束日期").fill(live ? "2024-01-01" : "2024-01-03");
  await page.getByRole("button", { name: "趋势参数设置" }).click();
  const settings = page.getByRole("dialog", { name: "趋势研究设置" });
  assert.equal(await settings.locator("input:visible, select:visible").count(), 7);
  assert.equal(await page.getByLabel("入场环境", { exact: true }).inputValue(), "background");
  assert.equal(await page.getByLabel("交易周期", { exact: true }).inputValue(), "240");
  assert.equal(await page.getByLabel("持仓管理", { exact: true }).inputValue(), "channel");
  assert.equal(
    await page.getByLabel("往返成本上限 · ATR（0 关闭）", { exact: true }).inputValue(),
    "0",
  );
  assert((await settings.textContent()).includes("也可能错过趋势启动"));
  await page.getByLabel("持仓管理", { exact: true }).selectOption("atr");
  await page.getByLabel("交易周期", { exact: true }).selectOption("1");
  await page.getByLabel("往返成本上限 · ATR（0 关闭）", { exact: true }).fill("0.5");
  assert.equal(await settings.locator("input:visible, select:visible").count(), 9);
  await settings.getByRole("button", { name: "使用无过滤基线 · 4 小时 / 仅做多" }).click();
  assert.equal(await page.getByLabel("入场环境", { exact: true }).inputValue(), "none");
  assert((await settings.textContent()).includes("不会排除更大范围的震荡"));
  assert.equal(await page.getByLabel("交易周期", { exact: true }).inputValue(), "240");
  assert.equal(await page.getByLabel("持仓管理", { exact: true }).inputValue(), "channel");
  assert.equal(await settings.locator("input:visible, select:visible").count(), 7);
  assert.equal(
    await page.getByLabel("往返成本上限 · ATR（0 关闭）", { exact: true }).inputValue(),
    "0.5",
  );
  await settings.getByRole("button", { name: "使用默认趋势方案 · 4 小时 / 日线背景" }).click();
  assert.equal(await page.getByLabel("入场环境", { exact: true }).inputValue(), "background");
  assert.equal(
    await page.getByLabel("往返成本上限 · ATR（0 关闭）", { exact: true }).inputValue(),
    "0.5",
    "both presets preserve the independent cost gate",
  );
  assert.equal(await page.getByLabel("保本触发 · ATR（0 关闭）", { exact: true }).count(), 0);
  await settings.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "趋势参数设置" }).click();
  assert.equal(await page.getByLabel("入场环境", { exact: true }).inputValue(), "background");
  assert.equal(
    await page.getByLabel("往返成本上限 · ATR（0 关闭）", { exact: true }).inputValue(),
    "0",
    "cancel discards preset drafts and their cost edits",
  );
  assert.equal(await page.getByLabel("持仓管理", { exact: true }).inputValue(), "channel");
  assert.equal(await page.getByLabel("交易周期", { exact: true }).inputValue(), "240");
  await page.getByLabel("初始止损 · ATR", { exact: true }).fill("2.5");
  await settings.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "趋势参数设置" }).click();
  assert.equal(
    await page.getByLabel("初始止损 · ATR", { exact: true }).inputValue(),
    "2",
    "cancel discards draft edits",
  );
  await page.getByLabel("初始止损 · ATR", { exact: true }).fill("0");
  assert(await settings.getByRole("button", { name: "应用设置", exact: true }).isDisabled());
  await page.getByLabel("初始止损 · ATR", { exact: true }).fill("1.5");
  await page.getByLabel("持仓管理", { exact: true }).selectOption("atr");
  await page.getByLabel("交易周期", { exact: true }).selectOption("1");
  await page.getByLabel("保本触发 · ATR（0 关闭）", { exact: true }).fill("1.5");
  await page.getByText("研究变体", { exact: true }).click();
  await page.getByLabel("交易方向", { exact: true }).selectOption("both");
  await page.getByText("研究变体", { exact: true }).click();
  await page.getByLabel("入场环境", { exact: true }).selectOption("none");
  await page.screenshot({ path: `${shots}/binance-trend-settings.png` });
  await settings.getByRole("button", { name: "应用设置", exact: true }).click();
  await runButton().click();
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
  await page.locator(".trend-result").waitFor({ timeout: 120000 });
  assert.equal(await page.locator(".trend-error").count(), 0);
  const result = await exportResult("binance-trend-result.json");
  assert.equal(result.manifest.provider, "binance-public-data");
  assert.equal(result.config.strategy.tradeMinutes, 1);
  assert.equal(result.engine, "trend-continuation-8");
  assert.equal(result.config.version, 5);
  assert.equal(result.config.strategy.maxCostAtr, 0);
  assert.equal(result.config.strategy.entry, "breakout");
  assert.equal(result.config.strategy.filter, "none");
  assert.equal(result.config.risk.flattenMinute, null);
  assert(
    result.chunks.every((chunk) => chunk.indicators.length === 0),
    "baseline omits unused EMA overlays",
  );
  assert.equal(result.manifest.rows, (researchDays + 1) * 1440);
  assert.equal(result.metrics.rows, (researchDays + 1) * 1440);
  assert(result.chunks.length > 1);
  const trades = result.chunks.flatMap((chunk) => chunk.trades);
  assert.equal(trades.length, result.metrics.trades);
  for (const trade of trades) {
    assert.equal(trade.entrySignal.time, trade.entryTime - 1);
    assert.equal(trade.entrySignal.lookbackBars, result.config.strategy.breakoutBars);
    assert(trade.entrySignal.atr > 0);
    assert(
      trade.side === "long"
        ? trade.entrySignal.price > trade.entrySignal.boundary
        : trade.entrySignal.price < trade.entrySignal.boundary,
      "frozen signal records the closed candle crossing its prior channel",
    );
  }
  assert(Number.isFinite(result.metrics.finalEquity));
  assert.equal(result.metrics.evaluation.totalDays, researchDays);
  assert.equal(result.metrics.evaluation.dailySharpe, null);
  assert(
    Math.abs(
      (result.metrics.evaluation.netExpectancy ?? 0) * trades.length -
        trades.reduce((sum, t) => sum + t.netPnl, 0),
    ) < 1e-7,
  );
  await page.getByText("收益质量与交易管理", { exact: true }).click();
  assert(await page.getByText("单笔净期望 · USDT", { exact: true }).isVisible());
  assert(
    Math.abs(
      result.metrics.finalEquity -
        result.config.execution.initialCapital -
        trades.reduce((n, t) => n + t.netPnl, 0),
    ) < 1e-7,
  );
  if (!live) {
    assert(trades.length > 0);
    assert.equal(requests, archiveRequests);
  }
  await page.getByRole("button", { name: "K 线与买卖点" }).click();
  await page.locator(".trend-chart canvas").first().waitFor();
  assert.equal(await page.getByLabel("K 线日期", { exact: true }).count(), 0);
  await page.waitForFunction(
    () => Number(document.querySelector(".trend-chart")?.dataset.visibleFrom) > 0,
  );
  if (!live) {
    const plot = page.locator(".trend-chart");
    const box = await plot.boundingBox();
    assert(box);
    for (
      let i = 0;
      i < 14 && Number(await plot.getAttribute("data-loaded-from")) >= start + 2 * day;
      i++
    ) {
      await page.mouse.move(box.x + 120, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width - 120, box.y + box.height / 2, { steps: 12 });
      await page.mouse.up();
      const before = Number(await plot.getAttribute("data-visible-to"));
      await page.waitForTimeout(300);
      const after = Number(await plot.getAttribute("data-visible-to"));
      assert(
        Math.abs(after - before) < minute * 2,
        "loading adjacent candles preserves the dragged viewport",
      );
    }
    assert(
      Number(await plot.getAttribute("data-loaded-from")) < start + 2 * day,
      "panning crosses UTC midnight without a date picker",
    );
    await page.getByRole("button", { name: "全区间", exact: true }).click();
    await page.waitForFunction(
      ([from, to]) => {
        const el = document.querySelector(".trend-chart");
        return Number(el?.dataset.loadedFrom) === from && Number(el?.dataset.loadedTo) === to;
      },
      [start, start + researchDays * day],
    );
    assert.equal(
      Number(await plot.getAttribute("data-display-minutes")),
      3,
      "wide views aggregate display candles without changing trading period",
    );
    assert(Number(await plot.getAttribute("data-candle-count")) <= 4096);
    await page.getByRole("button", { name: "最新", exact: true }).click();
    await page.waitForFunction(
      () => Number(document.querySelector(".trend-chart")?.dataset.displayMinutes) === 1,
    );
    await page.getByRole("button", { name: "查看交易 1", exact: true }).click();
    await page.waitForFunction((entry) => {
      const el = document.querySelector(".trend-chart");
      return Number(el?.dataset.visibleFrom) <= entry && Number(el?.dataset.visibleTo) > entry;
    }, trades[0].entryTime);
    const evidence = page.getByRole("region", { name: "交易 1 入场依据", exact: true });
    assert(await evidence.isVisible());
    assert((await evidence.textContent()).includes("信号时冻结的记录"));
    assert((await evidence.textContent()).includes("信号 ATR 14"));
    await page.waitForFunction(() => {
      const el = document.querySelector(".trend-chart");
      return Number(el?.dataset.channelPoints) > 0 && Number(el?.dataset.stopSegments) > 1;
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await evidence.scrollIntoViewIfNeeded();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert((await evidence.boundingBox()).width <= 390);
    await page.screenshot({ path: `${shots}/binance-trend-entry-mobile.png`, fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    assert.equal(requests, archiveRequests, "chart browsing uses frozen local archives");
  }
  await page.screenshot({ path: `${shots}/binance-trend.png`, fullPage: true });
  await page.getByRole("button", { name: "趋势参数设置" }).click();
  await page.getByText("研究变体", { exact: true }).click();
  await page.getByLabel("入场规则", { exact: true }).selectOption("pullback");
  assert.equal(await page.getByLabel("突破窗口 · 根 K 线", { exact: true }).count(), 0);
  await page.getByRole("button", { name: "应用设置", exact: true }).click();
  await runButton().click();
  await page.waitForFunction(
    () =>
      document.querySelector(".trend-result-heading")?.textContent.includes("回调突破 · 固定规则"),
    null,
    { timeout: 60000 },
  );
  if (!live) assert.equal(requests, archiveRequests, "parameter edits reuse frozen archives");
  await page.getByRole("button", { name: "趋势参数设置" }).click();
  await page.getByText("研究变体", { exact: true }).click();
  await page.getByLabel("入场规则", { exact: true }).selectOption("breakout");
  await page.getByRole("button", { name: "应用设置", exact: true }).click();
  await page.getByLabel("回测交易周期", { exact: true }).selectOption("5");
  assert(
    (await page.locator(".trend-result-heading").textContent()).includes("1 分钟"),
    "draft changes preserve frozen result period",
  );
  await runButton().click();
  await page.waitForFunction(
    () => document.querySelector(".trend-result-heading")?.textContent.includes("5 分钟"),
    null,
    { timeout: 60000 },
  );
  const five = await exportResult("binance-trend-five-minute.json");
  assert.equal(five.config.strategy.tradeMinutes, 5);
  assert.equal(five.config.strategy.filter, "none");
  assert.equal(five.manifest.warmupStart, result.manifest.warmupStart);
  assert.equal(five.manifest.partitions[0].checksum, result.manifest.partitions[0].checksum);
  const signals = five.chunks.flatMap((chunk) => chunk.events).filter((e) => e.kind === "signal");
  assert(signals.length > 0);
  assert(
    signals.every((e) => (e.time + 1) % (5 * minute) === 0),
    "signals wait for five-minute candle close",
  );
  assert(
    five.chunks.flatMap((chunk) => chunk.trades).every((t) => t.entryTime % (5 * minute) === 0),
    "entries fill at next minute open",
  );
  if (!live) assert.equal(requests, archiveRequests, "five-minute signals reuse minute archives");
  await page.getByRole("button", { name: "K 线与买卖点" }).click();
  await page
    .getByLabel("5 分钟 K 线与交易标记", { exact: true })
    .locator("canvas")
    .first()
    .waitFor();
  if (!live) {
    await page.getByRole("button", { name: "趋势参数设置" }).click();
    await page.getByLabel("持仓管理", { exact: true }).selectOption("channel");
    await page.getByRole("button", { name: "应用设置", exact: true }).click();
    await runButton().click();
    await page.waitForFunction(
      () =>
        document.querySelector(".trend-result-heading")?.textContent.includes("反向 10 根通道退出"),
      null,
      { timeout: 60000 },
    );
    const channel = await exportResult("binance-trend-channel.json");
    assert.equal(channel.config.strategy.management, "channel");
    assert.equal(channel.config.strategy.tradeMinutes, 5);
    assert(
      channel.chunks
        .flatMap((chunk) => chunk.events)
        .filter((e) => e.kind === "stop")
        .every((e) => e.reason === "initial"),
    );
    assert.equal(requests, archiveRequests, "channel management reuses frozen minute archives");
    await page.getByText("收益质量与交易管理", { exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: `${shots}/binance-trend-evaluation-mobile.png`, fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("button", { name: "趋势参数设置" }).click();
    await page.getByLabel("往返成本上限 · ATR（0 关闭）", { exact: true }).fill("0.5");
    await page.getByRole("button", { name: "应用设置", exact: true }).click();
    await runButton().click();
    await page.waitForFunction(
      () =>
        document.querySelector(".trend-result-heading")?.textContent.includes("往返成本 ≤ 0.5 ATR"),
      null,
      { timeout: 60000 },
    );
    const costOnly = await exportResult("binance-trend-cost-only.json");
    assert.equal(costOnly.config.strategy.filter, "none");
    assert.equal(costOnly.config.strategy.maxCostAtr, 0.5);
    assert.equal(costOnly.metrics.trades, 0);
    assert(costOnly.chunks.flatMap((c) => c.events).some((e) => e.reason === "entry-cost"));
    assert(costOnly.chunks.every((c) => (c.contexts ?? []).length === 0));
    assert.equal(
      requests,
      archiveRequests,
      "independent cost filtering reuses frozen minute archives",
    );
    await page.getByRole("button", { name: "趋势参数设置" }).click();
    await page.getByLabel("持仓管理", { exact: true }).selectOption("atr");
    await page.getByLabel("入场环境", { exact: true }).selectOption("background");
    assert((await settings.textContent()).includes("30 分钟背景"));
    await page.getByRole("button", { name: "应用设置", exact: true }).click();
    await runButton().click();
    await page.waitForFunction(
      () => document.querySelector(".trend-result-heading")?.textContent.includes("趋势背景"),
      null,
      { timeout: 60000 },
    );
    const background = await exportResult("binance-trend-background.json");
    const decisions = background.chunks.flatMap((chunk) => chunk.contexts ?? []);
    assert.equal(background.config.strategy.filter, "background");
    assert.equal(background.metrics.trades, 0);
    assert(background.chunks.flatMap((c) => c.events).some((e) => e.reason === "entry-cost"));
    assert.equal(background.metrics.context.reasons["context-cost"], undefined);
    assert(
      background.metrics.context.allowed > 0,
      "background allowance does not imply cost allowance",
    );
    assert(decisions.length > 20);
    assert.equal(background.metrics.context.evaluated, decisions.length);
    assert.equal(background.metrics.context.allowed, decisions.filter((d) => d.allowed).length);
    assert.equal(background.metrics.context.rejected, decisions.filter((d) => !d.allowed).length);
    assert(
      decisions.every(
        (d) => d.minutes === 30 && d.asOf <= d.time && (d.asOf + 1) % (30 * minute) === 0,
      ),
    );
    assert.equal(requests, archiveRequests, "background rules reuse minute archives");
    await page.getByRole("button", { name: "入场背景", exact: true }).click();
    await page.getByRole("button", { name: "查看背景信号 1", exact: true }).waitFor();
    assert.equal(await page.locator(".trend-context-panel tbody tr").count(), 20);
    await page.getByRole("button", { name: "下一页背景", exact: true }).click();
    await page.getByRole("button", { name: "查看背景信号 21", exact: true }).waitFor();
    await page.screenshot({ path: `${shots}/binance-trend-background.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: `${shots}/binance-trend-background-mobile.png`, fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("button", { name: "查看背景信号 21", exact: true }).click();
    await page.waitForFunction((time) => {
      const el = document.querySelector(".trend-chart");
      return Number(el?.dataset.visibleFrom) <= time && Number(el?.dataset.visibleTo) > time;
    }, decisions[20].time);
    // A separate zero-fee fixture case proves that eligible background signals
    // still enter, including sustained trends far from their lagging EMA.
    await page.getByRole("button", { name: "趋势参数设置" }).click();
    await page.getByRole("button", { name: "成交", exact: true }).click();
    await page.getByLabel("单边手续费 · bps", { exact: true }).fill("0");
    await page.getByLabel("单边滑点 · bps", { exact: true }).fill("0");
    await page.getByLabel("最小价格步长", { exact: true }).fill("0.01");
    await page.getByRole("button", { name: "应用设置", exact: true }).click();
    await runButton().click();
    await page.waitForFunction(
      () =>
        /^[1-9]\d* 笔交易/u.test(document.querySelector(".trend-accounting")?.textContent ?? ""),
      null,
      { timeout: 60000 },
    );
    const allowed = await exportResult("binance-trend-background-allowed.json");
    assert(allowed.metrics.context.allowed > 0 && allowed.metrics.trades > 0);
    assert(
      allowed.chunks.flatMap((c) => c.contexts ?? []).some((d) => d.allowed && d.extensionAtr > 3),
    );
    assert.equal(requests, archiveRequests, "changing cost assumptions reuses frozen data");
    await page.getByRole("button", { name: "趋势参数设置" }).click();
    await page.getByLabel("入场环境", { exact: true }).selectOption("ema");
    await page.getByRole("button", { name: "应用设置", exact: true }).click();
    await page.getByLabel("回测交易周期", { exact: true }).selectOption("60");
    await runButton().click();
    await page.waitForFunction(
      () => document.querySelector(".trend-result-heading")?.textContent.includes("1 小时"),
      null,
      { timeout: 60000 },
    );
    const hourly = await exportResult("binance-trend-hourly.json");
    assert.equal(hourly.config.strategy.tradeMinutes, 60);
    assert.equal(hourly.config.strategy.filter, "ema");
    assert.equal(hourly.manifest.warmupStart, start - 3 * day);
    assert.equal(hourly.manifest.rows, (researchDays + 3) * 1440);
    assert.equal(
      requests,
      archiveRequests + 4,
      "longer warmup downloads only two missing days of price and mark candles",
    );
    await page.getByRole("button", { name: "K 线与买卖点" }).click();
    await page
      .getByLabel("1 小时 K 线与交易标记", { exact: true })
      .locator("canvas")
      .first()
      .waitFor();
    // Switching back to a short rule must not inherit the longer cache's ATR seed.
    await page.getByRole("button", { name: "趋势参数设置" }).click();
    await page.getByLabel("入场环境", { exact: true }).selectOption("none");
    await page.getByLabel("交易周期", { exact: true }).selectOption("5");
    await page.getByLabel("往返成本上限 · ATR（0 关闭）", { exact: true }).fill("0");
    await page.getByRole("button", { name: "成交", exact: true }).click();
    await page
      .getByLabel("单边手续费 · bps", { exact: true })
      .fill(String(five.config.execution.feeBps));
    await page
      .getByLabel("单边滑点 · bps", { exact: true })
      .fill(String(five.config.execution.slippageBps));
    await page
      .getByLabel("最小价格步长", { exact: true })
      .fill(String(five.config.execution.tickSize));
    await page.getByRole("button", { name: "应用设置", exact: true }).click();
    await runButton().click();
    await page.waitForFunction(
      () => document.querySelector(".trend-result-heading")?.textContent.includes("5 分钟"),
      null,
      { timeout: 60000 },
    );
    const reused = await exportResult("binance-trend-reused-warmup.json");
    assert.deepEqual(reused.config, five.config);
    assert.equal(reused.manifest.warmupStart, hourly.manifest.warmupStart);
    assert.equal(reused.window.warmupStart, five.window.warmupStart);
    assert.deepEqual(reused.metrics, five.metrics);
    for (const field of ["equity", "trades", "events", "indicators", "contexts"])
      assert.deepEqual(
        reused.chunks.flatMap((c) => c[field] ?? []),
        five.chunks.flatMap((c) => c[field] ?? []),
      );
    assert.equal(requests, archiveRequests + 4, "short replay reuses wider frozen coverage");
    // Keep an unapplied next-run period while restoring the selected result below.
    await page.getByLabel("回测交易周期", { exact: true }).selectOption("60");
  }
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".trend-result").waitFor();
  assert((await page.locator(".trend-result-heading").textContent()).includes("通道突破基线"));
  assert.equal(
    await page.getByLabel("回测交易周期", { exact: true }).inputValue(),
    live ? "5" : "60",
  );
  await page.getByRole("button", { name: "趋势参数设置" }).click();
  assert.equal(
    await page.getByLabel("入场环境", { exact: true }).inputValue(),
    "none",
    "an explicit baseline choice survives reload after defaults migration",
  );
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "趋势运行历史" }).click();
  await page
    .locator(".trend-history")
    .getByRole("button")
    .filter({ hasText: "1 分钟" })
    .last()
    .click();
  await page.waitForFunction(() =>
    document.querySelector(".trend-result-heading")?.textContent.includes("1 分钟"),
  );
  assert.equal(
    await page.getByLabel("回测交易周期", { exact: true }).inputValue(),
    live ? "5" : "60",
    "selecting history leaves next-run parameters intact",
  );
  if (!live) {
    corrupt = true;
    await page.getByRole("button", { name: "更新档案", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "SHA-256" }).waitFor();
    assert.equal(
      await page.locator(".trend-result").count(),
      1,
      "failed refresh preserves the selected run",
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${shots}/binance-trend-mobile.png`, fullPage: true });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  assert.deepEqual(errors, []);
  console.log(
    `Binance trend workflow passed (${live ? "official live archives" : "deterministic archive fixtures"}; ${trades.length} trades).`,
  );
} catch (error) {
  console.error(
    await page
      .locator(".trend-workspace")
      .innerText({ timeout: 1000 })
      .catch(() => `Page unavailable: ${page.url()} · ${errors.join("; ")}`),
  );
  await page
    .screenshot({ path: `${shots}/binance-trend-failure.png`, fullPage: true })
    .catch(() => undefined);
  throw error;
} finally {
  await browser.close();
}
