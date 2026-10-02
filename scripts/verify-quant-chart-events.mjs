import assert from "node:assert/strict";
import { ensureShots, launchEphemeralBrowser } from "./lib/browser.mjs";

const shots = ensureShots();
const browser = await launchEphemeralBrowser({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const url = new URL(process.env.BASE_URL ?? "http://localhost:5297/quant");
url.pathname = "/quant";
const waitMarkers = async () =>
  page.waitForFunction(
    () => Number(document.querySelector(".research-chart-canvas")?.dataset.eventMarkerCount) > 0,
  );
const run = async () => {
  await page.getByRole("button", { name: "运行回测", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector(".research-status")?.textContent.includes("回测完成"),
    null,
    { timeout: 60_000 },
  );
  await waitMarkers();
};
try {
  await page.goto(url.toString(), { waitUntil: "networkidle" });
  await run();
  const id = await page.locator(".research-run-result").getAttribute("data-run-id");
  assert(
    Number(await page.locator(".research-chart-canvas").getAttribute("data-event-marker-count")) <=
      120,
  );
  await page.getByLabel("图表事件标记", { exact: true }).selectOption("none");
  await page.waitForFunction(
    () => document.querySelector(".research-chart-canvas")?.dataset.eventMarkerCount === "0",
  );
  await page.getByLabel("图表事件标记", { exact: true }).selectOption("signals");
  await waitMarkers();
  await page.getByLabel("图表事件标记", { exact: true }).selectOption("activity");
  await waitMarkers();
  const firstDate = await page
    .getByLabel("图表事件日期", { exact: true })
    .locator("option")
    .evaluateAll(
      (options) => options.find((option) => option.textContent.includes("笔成交"))?.value,
    );
  assert(firstDate);
  await page.getByLabel("图表事件日期", { exact: true }).selectOption(firstDate);
  await page.getByRole("button", { name: "查看事件", exact: true }).click();
  let panel = page.getByRole("dialog", { name: "组合事件", exact: true });
  await panel.waitFor();
  assert.equal(await panel.getByLabel("事件日期", { exact: true }).inputValue(), firstDate);
  await panel.locator(".research-event-order").first().waitFor();
  await panel.locator(".research-event-order").first().click();
  panel = page.getByRole("dialog", { name: "成交与行情", exact: true });
  await panel.getByRole("img", { name: /回测快照K线/ }).waitFor();
  await page.waitForFunction(
    () => Number(document.querySelector(".research-trade-canvas")?.dataset.fillMarkerCount) > 0,
  );
  assert(
    Number(await panel.locator(".research-trade-canvas").getAttribute("data-fill-marker-count")) <=
      160,
  );
  const detail = await panel.getByRole("region", { name: "选中订单详情" }).innerText();
  assert(detail.includes("次日开盘"));
  assert(detail.includes("信号日期"));
  await panel.getByLabel("K线价格口径", { exact: true }).selectOption("raw");
  await panel.getByRole("button", { name: "全部", exact: true }).click();
  await panel.getByRole("img", { name: /回测快照K线/ }).waitFor();
  await panel.getByLabel("K线价格口径", { exact: true }).selectOption("adjusted");
  await page.screenshot({ path: `${shots}/quant-trade-events-desktop.png`, fullPage: true });
  await panel.getByRole("button", { name: "当日账本", exact: true }).click();
  assert.equal(await page.getByLabel("持仓日期", { exact: true }).inputValue(), firstDate);
  await page.locator(".research-insights .research-table-link").first().click();
  panel = page.getByRole("dialog", { name: "成交与行情", exact: true });
  await panel.waitFor();
  await panel.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("tab", { name: "概览", exact: true }).click();
  await page.getByRole("button", { name: "查看事件", exact: true }).click();
  panel = page.getByRole("dialog", { name: "组合事件", exact: true });
  await panel.locator(".research-event-order").first().click();
  panel = page.getByRole("dialog", { name: "成交与行情", exact: true });
  await panel.getByRole("button", { name: "选股解释", exact: true }).click();
  const signalDate = await page.getByLabel("解释日期", { exact: true }).inputValue();
  assert(signalDate < firstDate);
  await page.locator(".research-insights .research-table-link").first().waitFor();
  await page.locator(".research-insights .research-table-link").first().click();
  panel = page.getByRole("dialog", { name: "成交与行情", exact: true });
  await panel.getByRole("button", { name: "成交表", exact: true }).click();
  await page.waitForFunction(
    (date) => document.querySelector('[aria-label="成交开始日期"]')?.value === date,
    signalDate,
  );
  await page.getByRole("button", { name: "清除筛选", exact: true }).click();
  await page.locator(".research-orders .research-table-link").first().waitFor();
  await page.locator(".research-orders .research-table-link").first().click();
  panel = page.getByRole("dialog", { name: "成交与行情", exact: true });
  await panel.getByRole("img", { name: /回测快照K线/ }).waitFor();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    assert.equal(await panel.evaluate((el) => el.scrollWidth > el.clientWidth), false);
  }
  await page.screenshot({ path: `${shots}/quant-trade-events-mobile.png`, fullPage: true });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload({ waitUntil: "networkidle" });
  await waitMarkers();
  assert.equal(await page.locator(".research-run-result").getAttribute("data-run-id"), id);
  // Warm the chart module/WASM assets, then query a different uncached symbol offline.
  await page.getByLabel("图表事件日期", { exact: true }).selectOption(firstDate);
  await page.getByRole("button", { name: "查看事件", exact: true }).click();
  panel = page.getByRole("dialog", { name: "组合事件", exact: true });
  await panel.locator(".research-event-order").first().click();
  panel = page.getByRole("dialog", { name: "成交与行情", exact: true });
  await panel.getByRole("img", { name: /回测快照K线/ }).waitFor();
  await panel.getByRole("button", { name: "当日全部证券", exact: true }).click();
  panel = page.getByRole("dialog", { name: "组合事件", exact: true });
  await panel.locator(".research-event-order").nth(1).waitFor();
  await context.setOffline(true);
  await panel.locator(".research-event-order").nth(1).click();
  panel = page.getByRole("dialog", { name: "成交与行情", exact: true });
  await panel.getByRole("img", { name: /回测快照K线/ }).waitFor();
  assert.equal(await panel.locator("[role='alert']").count(), 0);
  await context.setOffline(false);
  assert.deepEqual(errors, []);
  console.log(
    "Quant chart events PASSED: markers, signal/fill dates, snapshot candles, price modes, linked ledger/orders/explanations, mobile, reload and offline inspection",
  );
} catch (error) {
  await page
    .screenshot({ path: `${shots}/quant-chart-events-failure.png`, fullPage: true })
    .catch(() => undefined);
  console.error(errors);
  throw error;
} finally {
  await browser.close();
}
