import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { baseOrigin, ensureDir, launchEphemeralBrowser } from "./lib/browser.mjs";
import { installTrendArchives } from "./lib/trend-browser-fixture.mjs";

// Synthetic presentation evidence by default; an audited real export can be supplied separately.
const row = (candidate, costScenario = "base") => ({
  window: "dev",
  candidate,
  costScenario,
  netReturn: -0.02,
  dailyDrawdown: -0.03,
  trades: 10,
  netExpectancy: -2,
  profitFactor: 0.8,
  meanNetR: -0.2,
  dailySharpe: -0.4,
  dailyMean95CI: [-0.001, 0.001],
});
const fixture = {
  kind: "trend-research-review",
  version: 1,
  title: "流程测试 · 合成证据",
  engine: "fixture",
  assumptions: {
    capitalMode: "total-account-equal-sleeves",
    accountCapital: 10000,
    sleeveCapital: 10000,
    feeBps: 5,
    slippageBps: 2,
    stressFeeBps: 10,
    stressSlippageBps: 4,
  },
  identity: Object.fromEntries(
    ["planSha256", "manifestSha256", "selectionSha256", "rawResultsSha256", "evaluationSha256"].map(
      (key) => [key, "a".repeat(64)],
    ),
  ),
  selected: "n20",
  selectionRule: "Fixed fixture; no ranking.",
  symbols: ["BTCUSDT"],
  windows: [
    { id: "dev", role: "development", start: "2023-01-01", end: "2024-01-01" },
    { id: "val", role: "validation", start: "2024-01-01", end: "2025-01-01" },
  ],
  candidates: [20, 40].map((n) => ({
    id: `n${n}`,
    parameters: { "strategy.breakoutBars": n, "strategy.stopAtr": 2 },
  })),
  rows: [row("n20"), row("n40")],
  verdict: { status: "fail", stage: "development", scope: "development-base-only", cell: "dev" },
  findings: [
    {
      code: "positive-return",
      label: "净收益",
      actual: -0.02,
      threshold: ">0",
      status: "fail",
      evidence: "stage:dev",
    },
  ],
  limitations: ["Synthetic fixture, not a strategy result."],
  auditScope: "fixture",
  qualificationReasons: [],
};
const data = process.env.TREND_REVIEW_FILE
  ? JSON.parse(readFileSync(process.env.TREND_REVIEW_FILE, "utf8"))
  : fixture;
const shots = ensureDir("tmp/trend-review-browser");
const browser = await launchEphemeralBrowser({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
});
const page = await context.newPage(),
  errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const start = Date.UTC(2024, 0, 1),
  minute = 60_000;
await installTrendArchives(context, {
  start,
  price: (time) => 2000 + ((time - start) / minute) * 0.1,
});
try {
  await page.goto(`${baseOrigin("http://127.0.0.1:5201")}/quant?strategy=trend`, {
    waitUntil: "networkidle",
  });
  await page.getByRole("button", { name: "研究证据面板" }).click();
  const input = page.getByLabel("研究文件", { exact: true });
  await input.setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from("{}"),
  });
  await page.getByRole("alert").filter({ hasText: "不支持的文件版本" }).waitFor();
  await input.setInputFiles({
    name: "review.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(data)),
  });
  await page.getByRole("heading", { name: data.title, exact: true }).waitFor();
  assert.equal(
    await page.locator(".trend-verdict").getAttribute("data-status"),
    data.verdict.status,
  );
  await page
    .getByRole("button", { name: `${data.selected} · ${data.windows[0].id} · base`, exact: true })
    .click();
  await page.getByLabel("研究成本情景").selectOption("stress");
  await page.getByLabel("研究成本情景").selectOption("base");
  await page.screenshot({ path: `${shots}/research.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: `${shots}/research-mobile.png`, fullPage: true });
  await page.getByRole("button", { name: "研究证据面板" }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel("Binance 开始日期").fill("2024-01-01");
  await page.getByLabel("Binance 结束日期").fill("2024-01-03");
  await page.getByRole("button", { name: "趋势参数设置" }).click();
  const settings = page.getByRole("dialog", { name: "趋势研究设置" });
  await page.getByLabel("入场环境", { exact: true }).selectOption("none");
  await page.getByLabel("交易周期", { exact: true }).selectOption("30");
  await page.getByLabel("持仓管理", { exact: true }).selectOption("chandelier");
  await settings.getByRole("button", { name: "应用设置", exact: true }).click();
  await page.getByRole("button", { name: /^(获取并回测|运行回测)$/ }).click();
  await page.locator(".trend-result").waitFor({ timeout: 120000 });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出完整结果" }).click();
  await (await download).saveAs(`${shots}/result.json`);
  const result = JSON.parse(readFileSync(`${shots}/result.json`, "utf8"));
  const trade = result.chunks.flatMap((chunk) => chunk.trades)[0];
  assert(trade, "fixture must trade");
  await page.getByRole("button", { name: `查看交易 ${trade.id}`, exact: true }).click();
  const replay = page.getByRole("region", { name: `交易 ${trade.id} 决策复盘`, exact: true });
  const slider = replay.getByRole("slider", { name: "决策复盘进度" });
  await slider.waitFor();
  assert((await replay.textContent()).includes("等待成交"));
  assert(!(await replay.textContent()).includes("最终净盈亏"));
  await replay.getByRole("button", { name: "下一步" }).click();
  assert((await replay.textContent()).includes("多头"));
  await slider.focus();
  await slider.press("End");
  assert((await replay.textContent()).includes("已平仓"));
  assert((await replay.textContent()).includes("最终净盈亏"));
  const linked = result.chunks
    .flatMap((chunk) => chunk.events)
    .filter((event) => event.tradeId === trade.id);
  assert.equal(Number(await slider.getAttribute("max")), linked.length);
  await slider.press("Home");
  assert(!(await replay.textContent()).includes("最终净盈亏"));
  await page.screenshot({ path: `${shots}/replay.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await replay.scrollIntoViewIfNeeded();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: `${shots}/replay-mobile.png`, fullPage: true });
  await page.getByRole("button", { name: "研究证据面板" }).click();
  await page.getByRole("heading", { name: data.title, exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      review: data.title,
      verdict: data.verdict.status,
      replaySteps: linked.length + 1,
      mobileOverflow: false,
      errors,
    }),
  );
} finally {
  await context.close();
  await browser.close();
}
