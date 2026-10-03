import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { baseOrigin, ensureShots, launchEphemeralBrowser } from "./lib/browser.mjs";

// Explicit network integration check; excluded from deterministic CI.
// Default range reproduces the June 29, 2026 mark-price monthly archive gap.
const start = process.env.BINANCE_START ?? "2026-01-01";
const end = process.env.BINANCE_END ?? "2026-08-31";
const symbol = process.env.BINANCE_SYMBOL ?? "BTCUSDT";
const origin = baseOrigin(),
  shots = ensureShots();
const browser = await launchEphemeralBrowser({ headless: true });
const context = await browser.newContext({
  acceptDownloads: true,
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
const errors = [],
  sources = new Set();
let archiveRequests = 0;
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") console.error(message.text());
});
context.on("response", (response) => {
  if (
    response.url().startsWith("https://data.binance.vision/") &&
    response.url().endsWith(".zip")
  ) {
    archiveRequests++;
    sources.add(response.url());
    console.log(`Archive HTTP ${response.status()}: ${response.url().split("/").at(-1)}`);
  }
});
async function waitForResult() {
  const deadline = Date.now() + 300000;
  while (Date.now() < deadline) {
    const error = (await page.locator(".trend-error").allTextContents()).join("\n");
    assert.equal(error, "");
    if (await page.locator(".trend-result").count()) return;
    console.log((await page.locator(".trend-progress").allTextContents()).join(" ") || "Starting…");
    await page.waitForTimeout(5000);
  }
  throw new Error("Real Binance recovery/backtest exceeded five minutes");
}
try {
  await page.goto(`${origin}/quant?strategy=trend`, { waitUntil: "networkidle" });
  await page.getByLabel("Binance 交易对").fill(symbol);
  await page.getByLabel("Binance 开始日期").fill(start);
  await page.getByLabel("Binance 结束日期").fill(end);
  await page.getByLabel("回测交易周期", { exact: true }).selectOption("5");
  await page.getByRole("button", { name: "获取并回测", exact: true }).click();
  await waitForResult();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出完整结果" }).click();
  const path = `${shots}/binance-recovery-${symbol}.json`;
  await (await download).saveAs(path);
  const result = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(result.manifest.symbol, symbol);
  assert.equal(result.config.strategy.tradeMinutes, 5);
  assert.equal(result.manifest.startTime, Date.parse(`${start}T00:00:00Z`));
  assert.equal(result.manifest.endTime, Date.parse(`${end}T00:00:00Z`) + 86400000);
  assert.equal(result.metrics.rows, result.manifest.rows);
  const repairs = result.manifest.partitions.flatMap((p) => p.repairs ?? []);
  if (start <= "2026-06-29" && end >= "2026-06-29") {
    assert(repairs.some((r) => r.kind === "marks" && r.days.some((d) => d.date === "2026-06-29")));
    assert(
      sources.has(
        `https://data.binance.vision/data/futures/um/daily/markPriceKlines/${symbol}/1m/${symbol}-1m-2026-06-29.zip`,
      ),
    );
  }
  const trades = result.chunks.flatMap((chunk) => chunk.trades);
  assert.equal(trades.length, result.metrics.trades);
  assert(Number.isFinite(result.metrics.finalEquity));
  assert(
    Math.abs(
      result.metrics.finalEquity -
        result.config.execution.initialCapital -
        trades.reduce((sum, t) => sum + t.netPnl, 0),
    ) < 1e-6,
  );
  await page.getByRole("button", { name: "K 线与买卖点", exact: true }).click();
  await page
    .getByLabel("5 分钟 K 线与交易标记", { exact: true })
    .locator("canvas")
    .first()
    .waitFor();
  await page.screenshot({ path: `${shots}/binance-recovery.png`, fullPage: true });
  const downloaded = archiveRequests;
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".trend-result").waitFor();
  await page.getByRole("button", { name: "运行回测", exact: true }).click();
  await page.getByText("已复用相同数据与参数的结果", { exact: true }).waitFor();
  assert.equal(archiveRequests, downloaded, "restoration and replay reuse frozen repaired data");
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      symbol,
      start,
      end,
      minutes: 5,
      rows: result.metrics.rows,
      trades: trades.length,
      archives: sources.size,
      repairs: repairs.map((r) => ({ kind: r.kind, days: r.days.map((d) => d.date) })),
    }),
  );
} finally {
  await browser.close();
}
