import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureShots, launchEphemeralBrowser } from "./lib/browser.mjs";

const origin = new URL(process.env.BASE_URL ?? "http://localhost:5202").origin;
const url = `${origin}/markets?view=macro&layer=history`;
const browser = await launchEphemeralBrowser({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await context.newPage();
page.setDefaultTimeout(15_000);
const errors = [],
  external = [];
const shots = ensureShots();
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (request) => {
  if (!request.url().startsWith(origin)) external.push(request.url());
});
const chartReady = () => page.locator('.macro-chart[data-ready="true"] svg').waitFor();
const rangeIs = (range) =>
  page.waitForFunction(
    (value) => document.querySelector(".macro-atlas")?.getAttribute("data-range") === value,
    range,
  );
const noOverflow = async (target = page) =>
  target.waitForFunction(
    () =>
      document.documentElement.scrollWidth <= innerWidth + 1 &&
      [...document.querySelectorAll(".macro-main, .macro-chart-panel")].every(
        (element) => element.scrollWidth <= element.clientWidth + 1,
      ),
    null,
    { timeout: 5000 },
  );
try {
  // An existing market shelf must not trigger stock requests from the macro view.
  await context.addInitScript(() =>
    localStorage.setItem(
      "bcr.market-atlas.instruments.v1",
      JSON.stringify([
        { id: "US:NASDAQ:AAPL", symbol: "AAPL", name: "苹果", market: "US", assetClass: "equity" },
      ]),
    ),
  );
  await page.goto(`${url}&instrument=US%3ANASDAQ%3AAAPL`, { waitUntil: "networkidle" });
  await chartReady();
  assert.equal(await page.locator(".macro-country-card").count(), 4);
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.deepEqual(external, [], "Bundled data must load without external data or stock requests");
  await noOverflow();
  await page.screenshot({ path: `${shots}/macro-desktop.png` });
  console.log("[macro] Bundled data and existing stock shelf isolation passed");
  const focusButton = page.getByRole("button", { name: "聚焦中国曲线", exact: true });
  await focusButton.click();
  assert.equal(await focusButton.getAttribute("aria-pressed"), "true");
  assert.equal(await page.locator(".macro-chart").getAttribute("data-focused-country"), "CHN");
  await focusButton.press("Enter");
  assert.equal(await focusButton.getAttribute("aria-pressed"), "false");
  await page.locator(".macro-chart").scrollIntoViewIfNeeded();
  const hoverBox = await page.locator(".macro-chart").boundingBox();
  assert(hoverBox);
  await page.mouse.move(hoverBox.x + hoverBox.width * 0.45, hoverBox.y + 80);
  await page.locator('.macro-readout-period[data-hovering="true"]').waitFor();
  const hoverYear = await page.locator(".macro-readout-period > span").innerText();
  assert.equal(await focusButton.locator("small").innerText(), hoverYear);
  await page.mouse.move(hoverBox.x + 10, hoverBox.y - 10);
  await page.locator('.macro-readout-period[data-hovering="false"]').waitFor();

  await page.getByRole("button", { name: "CPI 通胀", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector(".macro-atlas")?.getAttribute("data-indicator") === "inflation",
  );
  await page.getByRole("button", { name: "查看数据表", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "CPI 年度通胀率 · 年度数据表" });
  await dialog.waitFor();
  assert.equal(await dialog.locator("tbody tr").count(), 36);
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 CSV", exact: true }).click();
  const file = await download;
  assert.match(file.suggestedFilename(), /^macro-inflation-/u);
  const csv = await readFile(await file.path(), "utf8");
  assert(csv.includes("World Bank WDI") && csv.includes('"inflation"'));
  assert.equal(csv.split("\r\n").length, 145);

  await page.getByRole("button", { name: "数据说明", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "数据来源与统计口径" });
  await dialog.waitFor();
  assert((await dialog.innerText()).includes("217 个经济体"));
  assert.equal(await dialog.locator('a[href^="https://data.worldbank.org/indicator/"]').count(), 6);
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();

  console.log("[macro] Indicators, data table, CSV and source documentation passed");
  await page.getByRole("button", { name: "复制当前看板链接", exact: true }).click();
  assert(
    (await page.evaluate(() => navigator.clipboard.readText())).includes("indicator=inflation"),
  );
  await page.getByLabel("起始年份", { exact: true }).selectOption("2019");
  await page.getByLabel("结束年份", { exact: true }).selectOption("2020");
  await rangeIs("2019-2020");
  assert(
    (await page.locator(".macro-event-list").innerText()).includes("WHO 将 COVID-19 定性为大流行"),
  );
  // End-year markers must remain visible, and clicking a real SVG marker must focus it.
  await page.waitForFunction(() => {
    const chart = document.querySelector(".macro-chart");
    return (
      chart?.querySelectorAll('svg path[d="M0 -1L1 0L0 1L-1 0Z"]').length ===
      Number(chart?.getAttribute("data-marker-count"))
    );
  });
  const marker = page
    .locator('.macro-chart svg path[d="M0 -1L1 0L0 1L-1 0Z"]')
    .filter({ visible: true })
    .first();
  assert(await marker.count(), "Events in the selected ending year must remain visible");
  await marker.click({ force: true });
  await page.waitForFunction(() => new URLSearchParams(location.search).has("event"));
  await page.getByLabel("重置时间范围", { exact: true }).click();
  await rangeIs("1980-2025");
  await page.getByLabel("起始年份", { exact: true }).selectOption("2023");
  await page.getByRole("button", { name: "政策与制度", exact: true }).click();
  const clusterSize = (
    await page.locator(".macro-event-card .macro-event-year").allTextContents()
  ).filter((year) => year === "2024").length;
  assert(clusterSize > 1, "The selected window contains multiple 2024 policy events");
  await page
    .locator(".macro-chart svg text")
    .filter({ hasText: new RegExp(`^${clusterSize}$`, "u") })
    .first()
    .click();
  const cluster = page.getByRole("dialog", { name: "同年历史事件", exact: true });
  await cluster.waitFor();
  assert.equal(await cluster.locator(".macro-cluster-list button").count(), clusterSize);
  await cluster.locator(".macro-cluster-list button").last().click();
  await page.getByLabel("重置时间范围", { exact: true }).click();
  await rangeIs("1980-2025");
  await page.getByRole("button", { name: "金融与经济冲击", exact: true }).click();
  await page.locator(".macro-event-card").filter({ hasText: "雷曼破产与全球金融危机升级" }).click();
  await rangeIs("2005-2011");
  assert((await page.getByLabel("事件观察", { exact: true }).innerText()).includes("2008.09.15"));
  assert((await page.getByLabel("事件观察", { exact: true }).innerText()).includes("2007 年"));
  await page.screenshot({ path: `${shots}/macro-event-focus.png` });
  console.log("[macro] Ending-year event marker and event focus passed");

  await page.getByRole("button", { name: "重置时间范围", exact: true }).click();
  await rangeIs("1980-2025");
  const zoomHandle = page.locator('.macro-chart svg path[d^="M0 1.628"]').first();
  await zoomHandle.scrollIntoViewIfNeeded();
  const handleBox = await zoomHandle.boundingBox();
  assert(handleBox);
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + 110, handleBox.y + handleBox.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(
    () => document.querySelector(".macro-atlas")?.getAttribute("data-range") !== "1980-2025",
  );
  await page.getByRole("button", { name: "重置时间范围", exact: true }).click();
  await rangeIs("1980-2025");
  await page.getByRole("button", { name: "增长 × 通胀", exact: true }).click();
  await page.getByLabel("相位图年份", { exact: true }).fill("2008");
  await page.getByRole("button", { name: "播放历史轨迹", exact: true }).click();
  await page.waitForFunction(() => Number(document.querySelector("#macro-year")?.value) > 2008);
  await page.getByRole("button", { name: "暂停历史播放", exact: true }).click();
  await page.getByLabel("结束年份", { exact: true }).selectOption("2000");
  assert.equal(await page.getByLabel("相位图年份", { exact: true }).inputValue(), "2000");
  await page.screenshot({ path: `${shots}/macro-phase.png` });
  await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector(".macro-main"))
        .getPropertyValue("--color-bg")
        .trim() === "#f4f4f2",
  );
  await page.screenshot({ path: `${shots}/macro-light.png` });
  await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  console.log("[macro] Phase playback, range consistency and theme switching passed");

  await page.getByRole("button", { name: "趋势对比", exact: true }).click();
  await page.getByRole("button", { name: "重置时间范围", exact: true }).click();
  await page.locator(".macro-sidebar").getByLabel("搜索国家或经济体", { exact: true }).fill("印度");
  await page.locator(".macro-country-row").filter({ hasText: "印度" }).first().click();
  assert.equal(await page.locator(".macro-country-card").count(), 5);
  await page.reload({ waitUntil: "networkidle" });
  await chartReady();
  assert.equal(await page.locator(".macro-country-card").count(), 5);

  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await noOverflow();
    if (width <= 390) {
      await page.getByRole("button", { name: "选择经济体", exact: true }).click();
      dialog = page.getByRole("dialog", { name: "选择比较经济体", exact: true });
      await dialog.waitFor();
      await dialog.getByLabel("搜索国家或经济体", { exact: true }).fill("BRA");
      await dialog.locator(".macro-country-row").filter({ hasText: "巴西" }).click();
      await dialog.getByRole("button", { name: "完成选择", exact: true }).click();
      assert.equal(await page.locator(".macro-country-card").count(), width === 390 ? 6 : 5);
    }
    await page.screenshot({ path: `${shots}/macro-${width}.png` });
  }
  assert.deepEqual(external, [], "All exploration interactions must work from bundled data");
  await page.route("https://api.worldbank.org/**", (route) => route.abort());
  await page.getByRole("button", { name: "手动更新", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "暂时无法连接世界银行" }).waitFor();
  assert.equal(await page.locator(".macro-country-card").count(), 5);
  await chartReady();
  assert.deepEqual(errors, []);
  await page.unroute("https://api.worldbank.org/**");
  let refreshRequests = 0;
  const envelope = (rows) =>
    JSON.stringify([{ page: 1, pages: 1, total: rows.length, lastupdated: "2026-10-25" }, rows]);
  await page.route("https://api.worldbank.org/**", (route) => {
    refreshRequests += 1;
    const rows = new URL(route.request().url()).pathname.includes("/indicator/")
      ? [
          "NY.GDP.MKTP.KD.ZG",
          "FP.CPI.TOTL.ZG",
          "NY.GDP.MKTP.CD",
          "NY.GDP.PCAP.CD",
          "SL.UEM.TOTL.ZS",
          "NE.TRD.GNFS.ZS",
        ].map((id) => ({ countryiso3code: "USA", indicator: { id }, date: "2025", value: 1.2345 }))
      : [
          {
            id: "USA",
            iso2Code: "US",
            name: "United States",
            region: { id: "NAC", value: "North America" },
          },
        ];
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: {
        "access-control-allow-origin": "*",
        "cross-origin-resource-policy": "cross-origin",
      },
      body: envelope(rows),
    });
  });
  await page.goto(`${url}&countries=USA`, { waitUntil: "networkidle" });
  await chartReady();
  await page.getByRole("button", { name: "手动更新", exact: true }).click();
  await page.getByText("所选国家已更新并保存", { exact: true }).waitFor();
  assert.equal(refreshRequests, 2);
  assert((await page.locator(".macro-card-value").innerText()).includes("1.23%"));
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("本地保存的官方数据", { exact: true }).waitFor();
  assert.equal(refreshRequests, 2, "Reload must reuse OPFS without another data request");
  assert((await page.locator(".macro-card-value").innerText()).includes("1.23%"));
  console.log(
    "Macro browser verification passed: bundled offline data, stock shelf isolation, filters, event focus, phase playback, URL restore, source/table dialogs, CSV, themes, 768/390/320px reflow, refresh failure and persisted manual refresh.",
  );
} catch (error) {
  console.error(`[macro] Failed at ${page.url()}`);
  await page.screenshot({ path: `${shots}/macro-failure.png` }).catch(() => {});
  throw error;
} finally {
  await context.close();
  await browser.close();
}
