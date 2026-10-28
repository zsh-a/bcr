import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { baseUrl, ensureShots, launchEphemeralBrowser } from "./lib/browser.mjs";

const origin = new URL(baseUrl("http://localhost:5202")).origin;
const host = new URL(origin).port === "5202" ? "standalone" : "studio";
const url = `${origin}/markets?view=macro&layer=debt`,
  shots = ensureShots();
const resources = await Promise.all(
  ["bis", "china", "fiscal"].map(async (source) =>
    JSON.parse(
      await readFile(
        new URL(`../packages/market-data/src/debt/${source}-snapshot.json`, import.meta.url),
        "utf8",
      ),
    ),
  ),
);
const series = resources.flatMap((resource) => resource.series);
const names = { CHN: "中国", USA: "美国", JPN: "日本", DEU: "德国", GBR: "英国" };
const units = {
  percentGdp: "% GDP",
  percentIncome: "% 收入",
  percentRevenue: "% 财政收入",
  percent: "%",
  percentagePoints: "百分点",
  trillionLocal: "万亿",
  billionLocal: "十亿",
};
const number = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
const get = (country, indicator) =>
  series.find((item) => item.country === country && item.indicator === indicator);
const exact = (source, period) => source?.observations.find((point) => point.period === period);
const month = (period) =>
  /^\d{4}$/u.test(period)
    ? `${period}-12`
    : /^\d{4}-Q[1-4]$/u.test(period)
      ? `${period.slice(0, 4)}-${String(Number(period.at(-1)) * 3).padStart(2, "0")}`
      : period;
const latest = (source, end = "9999-12") =>
  source?.observations.filter((point) => point.value !== null && month(point.period) <= end).at(-1);
const quarterIndex = (period) => Number(period.slice(0, 4)) * 4 + Number(period.at(-1)) - 1;
const quarterPeriod = (index) => `${Math.floor(index / 4)}-Q${(index % 4) + 1}`;
const formatted = (source, point) =>
  point?.value === null || point?.value === undefined
    ? "—"
    : `${number.format(point.value)} ${units[source.unit]}${source.currency ? ` ${source.currency}` : ""}`;
const browser = await launchEphemeralBrowser({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1050 },
  reducedMotion: "reduce",
  colorScheme: "dark",
  acceptDownloads: true,
});
const page = await context.newPage(),
  errors = [],
  external = [],
  requests = [];
page.setDefaultTimeout(15_000);
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
page.on("request", (request) => requests.push(request.url()));
await context.route("**/*", async (route) => {
  const target = new URL(route.request().url());
  if (["http:", "https:"].includes(target.protocol) && target.origin !== origin) {
    external.push(target.href);
    await route.abort();
  } else await route.continue();
});
const atlas = () => page.locator(".debt-atlas"),
  card = (id) => page.locator(".debt-country-card").filter({ hasText: id });
const readout = (id) => page.locator(".debt-readouts > div").filter({ hasText: names[id] });
const quarterSelect = () => page.getByLabel("精确选择债务季度", { exact: true });
const metricSelect = () => page.getByLabel("债务趋势指标", { exact: true });
async function waitParam(key, value) {
  await page.waitForFunction(
    ([key, value]) => new URLSearchParams(location.search).get(key) === value,
    [key, value],
  );
}
async function chartReady(kind) {
  await page.locator(`.debt-chart-${kind}[data-ready="true"] svg`).waitFor();
}
async function setMetric(metric) {
  await metricSelect().selectOption(metric);
  await waitParam("debtMetric", metric);
  await page.locator(`.debt-atlas[data-metric="${metric}"]`).waitFor();
  await chartReady("trend");
}
async function setQuarter(quarter) {
  await quarterSelect().selectOption(quarter);
  await page.locator(`.debt-atlas[data-quarter="${quarter}"]`).waitFor();
}
async function setAsOf(value) {
  await page.getByLabel("债务趋势截止方式", { exact: true }).selectOption(value);
  await waitParam("debtAsOf", value);
}
async function noOverflow() {
  await page.waitForFunction(
    () =>
      document.documentElement.scrollWidth <= innerWidth + 1 &&
      [
        ...document.querySelectorAll(
          ".debt-atlas, .macro-main, .macro-chart-panel, .debt-chart-figure",
        ),
      ].every((element) => element.scrollWidth <= element.clientWidth + 1),
  );
}
async function assertReading(country, metric, end) {
  const source = get(country, metric),
    point = latest(source, end);
  assert.equal(await readout(country).locator("strong").innerText(), formatted(source, point));
  if (point) assert((await readout(country).locator("small").innerText()).includes(point.period));
}
function csvRows(text) {
  const rows = [],
    row = [];
  let cell = "",
    quoted = false;
  const input = text.replace(/^\uFEFF/u, "");
  for (let index = 0; index < input.length; index++) {
    const character = input[index];
    if (character === '"') {
      if (quoted && input[index + 1] === '"') {
        cell += '"';
        index++;
      } else quoted = !quoted;
    } else if (!quoted && (character === "," || character === "\n")) {
      row.push(cell.replace(/\r$/u, ""));
      cell = "";
      if (character === "\n") rows.push(row.splice(0));
    } else cell += character;
  }
  if (cell || row.length) {
    row.push(cell.replace(/\r$/u, ""));
    rows.push(row);
  }
  return rows;
}
async function exportRows(metric) {
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出债务 CSV", exact: true }).click();
  const download = await event;
  assert(download.suggestedFilename().startsWith(`debt-${metric}-`));
  await download.saveAs(`${shots}/debt-${host}-${metric}.csv`);
  const [header, ...rows] = csvRows(await readFile(await download.path(), "utf8"));
  assert.deepEqual(header, [
    "country",
    "country_name",
    "indicator",
    "indicator_name",
    "period",
    "value",
    "unit",
    "currency",
    "frequency",
    "seasonal_adjustment",
    "valuation",
    "status",
    "source",
    "series_code",
    "source_url",
    "license_url",
    "fetched_at",
    "source_updated_at",
    "note",
  ]);
  return rows.map((row) => Object.fromEntries(header.map((key, index) => [key, row[index]])));
}
function assertExport(rows, source, point) {
  const row = rows.find(
    (row) =>
      row.country === source.country &&
      row.indicator === source.indicator &&
      row.period === point.period,
  );
  assert(row, `Export contains ${source.country} ${source.indicator} ${point.period}`);
  assert.equal(row.value, point.value === null ? "" : String(point.value));
  for (const [key, value] of Object.entries({
    unit: source.unit,
    currency: source.currency ?? "",
    frequency: source.frequency,
    seasonal_adjustment: source.seasonalAdjustment,
    valuation: source.valuation,
    status: point.status ?? "",
    source: source.source.name,
    series_code: source.source.seriesCode,
    source_url: source.source.url,
    license_url: source.source.licenseUrl,
    fetched_at: source.fetchedAt,
    source_updated_at: source.sourceUpdatedAt ?? "",
    note: source.note,
  }))
    assert.equal(row[key], value, key);
  return row;
}
async function screenshot(name, target = page) {
  if (target !== page)
    await target.evaluate((element) => element.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(100);
  await target.screenshot({ path: `${shots}/debt-${host}-${name}.png` });
}
async function svgValues(kind) {
  return page
    .locator(`.debt-chart-${kind} svg text`)
    .evaluateAll((labels) => labels.map((label) => label.textContent));
}
async function trendColors() {
  const colors = await page.evaluate(() =>
    ["--color-accent", "--color-info", "--color-amber", "--color-danger", "--color-success"].map(
      (token) => getComputedStyle(document.documentElement).getPropertyValue(token).trim(),
    ),
  );
  return page
    .locator(".debt-chart-trend svg path[stroke]")
    .evaluateAll(
      (paths, colors) => [
        ...new Set(
          paths
            .map((path) => path.getAttribute("stroke"))
            .filter((color) => colors.includes(color)),
        ),
      ],
      colors,
    );
}
try {
  await page.goto(url, { waitUntil: "networkidle" });
  await chartReady("structure");
  await chartReady("trend");
  const current = await atlas().getAttribute("data-quarter");
  assert.equal(await atlas().getAttribute("data-mode"), "structure");
  assert.equal(await page.locator(".debt-country-card").count(), 4);
  for (const id of ["CHN", "USA", "JPN", "DEU"]) {
    const point = exact(get(id, "privateDebt"), current);
    assert(point && point.value !== null);
    assert.equal(
      (await card(id).locator(":scope > strong").innerText()).replace(/\s/gu, ""),
      `${number.format(point.value)}%GDP`,
    );
    assert.equal(await card(id).locator(":scope > p").innerText(), current);
  }
  const structureLabels = await svgValues("structure");
  for (const indicator of ["householdDebt", "corporateDebt", "governmentDebt"])
    assert(structureLabels.includes(number.format(exact(get("USA", indicator), current).value)));
  assert.equal(
    await page.getByRole("list", { name: "债务部门", exact: true }).getByRole("listitem").count(),
    3,
  );
  assert((await page.locator(".macro-page-footer").innerText()).includes("非官方翻译"));
  await noOverflow();
  await screenshot("desktop");
  await card("USA").press("Enter");
  await waitParam("debtFocus", "USA");
  assert.equal(await card("USA").getAttribute("aria-pressed"), "true");
  await page.locator(".macro-sidebar .macro-country-row").filter({ hasText: "GBR" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".debt-country-card").length === 5);
  const windowSelect = page.getByLabel("债务比较窗口", { exact: true });
  for (const [window, count] of [
    ["5y", 20],
    ["10y", 40],
    ["all", null],
  ]) {
    await windowSelect.selectOption(window);
    await waitParam("debtWindow", window);
    await page.waitForFunction((count) => {
      const length = document.querySelector('[aria-label="精确选择债务季度"]')?.options.length;
      return count === null ? length > 40 : length === count;
    }, count);
  }
  const quarters = await quarterSelect()
    .locator("option")
    .evaluateAll((options) => options.map((option) => option.value));
  const missingQuarter = quarters.find(
    (quarter) =>
      exact(get("CHN", "governmentDebt"), quarter)?.value != null &&
      exact(get("CHN", "householdDebt"), quarter)?.value == null,
  );
  assert(missingQuarter);
  await setQuarter(missingQuarter);
  const amber = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--color-amber").trim(),
  );
  await page.locator(`.debt-chart-structure svg path[fill="${amber}"]`).first().hover();
  const gapTooltip = page.locator(".debt-chart-structure .macro-chart-tooltip");
  await gapTooltip.waitFor();
  const gapText = (await gapTooltip.innerText()).replace(/\s/gu, "");
  assert(gapText.includes("中国") && gapText.includes("居民—") && gapText.includes("非金融企业—"));
  await page.getByRole("button", { name: "信用相位", exact: true }).click();
  await chartReady("phase");
  assert((await page.locator(".debt-chart-figure-phase figcaption").innerText()).includes("0/5"));
  await setQuarter(current);
  await chartReady("phase");
  const base = Array.from(
    { length: 40 },
    (_, index) =>
      exact(get("USA", "debtService"), quarterPeriod(quarterIndex(current) - 40 + index)).value,
  );
  const baseline = base.reduce((sum, value) => sum + value, 0) / 40,
    service = exact(get("USA", "debtService"), current).value;
  assert.equal(
    await card("USA").locator("b").innerText(),
    `${service - baseline >= 0 ? "+" : ""}${number.format(service - baseline)} pp`,
  );
  const info = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--color-info").trim(),
  );
  await page
    .locator(".debt-chart-phase")
    .evaluate((element) => element.scrollIntoView({ block: "center" }));
  await page.locator(`.debt-chart-phase svg path[fill="${info}"]`).first().hover();
  const phaseTip = page.locator(".debt-chart-phase .macro-chart-tooltip");
  await phaseTip.waitFor();
  assert(
    (await phaseTip.innerText()).includes(`${number.format(baseline)} % 收入`) &&
      (await phaseTip.innerText()).includes("40 个连续季度"),
  );
  const ticks = (values) => values.filter((value) => /^-?[\d,.]+$/u.test(value)).sort();
  const frame = ticks(await svgValues("phase"));
  await page.getByLabel("债务观察季度", { exact: true }).press("ArrowLeft");
  await page.locator(`.debt-atlas[data-quarter="${quarters.at(-2)}"]`).waitFor();
  assert.deepEqual(ticks(await svgValues("phase")), frame);
  await setQuarter(current);
  await windowSelect.selectOption("10y");
  await waitParam("debtWindow", "10y");
  await page.mouse.move(1, 1);
  await page
    .locator(".debt-chart-figure-phase")
    .evaluate((element) => element.scrollIntoView({ block: "center" }));
  await screenshot("phase", page.locator(".debt-chart-figure-phase"));
  console.log(
    "[debt] Official quarterly values, sectors, missing-not-zero, focus, windows, exact phase baseline and fixed frame passed",
  );

  await setMetric("socialFinancingGrowth");
  await setAsOf("latest");
  await assertReading("CHN", "socialFinancingGrowth");
  assert.equal(get("CHN", "socialFinancingGrowth").currency, null);
  assert((await readout("CHN").innerText()).includes("2026-09"));
  await setAsOf("quarter");
  await assertReading("CHN", "socialFinancingGrowth", month(current));
  assert((await readout("CHN").innerText()).includes("2026-03"));
  await setMetric("corporateBondFlow");
  await setAsOf("latest");
  await assertReading("CHN", "corporateBondFlow");
  const bond = get("CHN", "corporateBondFlow"),
    negative = latest(bond);
  assert(negative.value < 0);
  let rows = await exportRows("corporateBondFlow");
  assertExport(rows, bond, negative);
  assert(
    rows.filter((row) => row.country === "CHN").every((row) => /^\d{4}-\d{2}$/u.test(row.period)),
  );
  await page.getByRole("button", { name: "查看债务数据表", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: /· 债务数据表$/u });
  await dialog.waitFor();
  let first = dialog.getByLabel("CHN 债务数据表", { exact: true }).locator("tbody tr").first();
  assert.equal(await first.locator("th").innerText(), negative.period);
  assert.equal(await first.locator("td").first().innerText(), formatted(bond, negative));
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  await screenshot("monthly", page.locator(".debt-trend-panel"));
  console.log(
    "[debt] Monthly latest versus quarter cutoff, negative financing flow, native table and precise CSV metadata passed",
  );

  await setMetric("creditGrowth");
  const stock = get("USA", "privateCreditStock"),
    stockNow = latest(stock),
    stockPrevious = exact(stock, quarterPeriod(quarterIndex(stockNow.period) - 4));
  const growth = (stockNow.value / stockPrevious.value - 1) * 100;
  assert.equal(await readout("USA").locator("strong").innerText(), `${number.format(growth)} %`);
  assert((await readout("USA").locator("small").innerText()).includes("本币余额同比计算值"));
  rows = await exportRows("creditGrowth");
  const derived = rows.find((row) => row.country === "USA" && row.period === stockNow.period);
  assert.equal(Number(derived.value), growth);
  assert(derived.status.startsWith("derived"));
  assert(derived.series_code.endsWith("derived-yoy-4q"));
  assert.equal(derived.currency, "");
  await setMetric("privateCreditStock");
  await assertReading("USA", "privateCreditStock");
  assert(
    (await page.locator(".debt-trend-panel .debt-chart-controls p").innerText()).includes(
      "不跨币种比较",
    ),
  );
  assert.deepEqual(await trendColors(), [info]);
  await card("JPN").click();
  await waitParam("debtFocus", "JPN");
  await page.locator('.debt-chart-trend[data-focused-country="JPN"]').waitFor();
  assert.deepEqual(await trendColors(), [amber]);
  rows = await exportRows("privateCreditStock");
  assertExport(rows, stock, stockNow);
  assert(rows.every((row) => /^\d{4}-Q[1-4]$/u.test(row.period)));
  console.log(
    "[debt] Four-quarter calculated growth/status, original currency metadata and focus-only currency chart passed",
  );

  for (const metric of ["governmentInterestBurden", "fiscalBalance"]) {
    await setMetric(metric);
    await setAsOf("latest");
    for (const id of ["CHN", "USA", "JPN", "DEU", "GBR"]) await assertReading(id, metric);
    assert((await readout("JPN").locator("small").innerText()).includes("暂未收录"));
    if (metric === "governmentInterestBurden") {
      assert((await readout("CHN").locator("small").innerText()).includes("2021"));
      assert((await readout("CHN").locator("small").innerText()).includes("观测期较早"));
    }
    rows = await exportRows(metric);
    assert(rows.every((row) => /^\d{4}$/u.test(row.period)));
    const fiscal = get("USA", metric);
    assertExport(rows, fiscal, latest(fiscal));
  }
  await screenshot("fiscal", page.locator(".debt-trend-panel"));
  await page.getByRole("button", { name: "债务数据说明", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "债务数据 · 来源与统计口径", exact: true });
  await dialog.waitFor();
  assert(
    (await dialog.innerText()).includes("非官方翻译") &&
      (await dialog.innerText()).includes("均值不含当季"),
  );
  const coverage = await dialog.locator(".debt-coverage-scroll").innerText();
  assert(coverage.includes("2026-09") && coverage.includes("2021") && coverage.includes("2024"));
  const links = await dialog
    .locator("a")
    .evaluateAll((links) => links.map((link) => ({ href: link.href, rel: link.rel })));
  assert(
    links.length > 20 &&
      links.every((link) => link.href.startsWith("https://") && link.rel.includes("noopener")),
  );
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  const restored = page.url();
  await page.reload({ waitUntil: "networkidle" });
  await chartReady("phase");
  assert.equal(page.url(), restored);
  assert.equal(await metricSelect().inputValue(), "fiscalBalance");
  const nav = page.getByRole("navigation", { name: "宏观研究视图", exact: true });
  assert.equal(await nav.getByRole("button").count(), 4);
  await nav.getByRole("button", { name: "长期比较", exact: true }).click();
  await page.locator(".macro-chart svg").waitFor();
  await nav.getByRole("button", { name: "周期监测", exact: true }).click();
  await page.locator(".cycle-chart-phase svg").waitFor();
  await nav.getByRole("button", { name: "债务信用", exact: true }).click();
  await chartReady("phase");
  console.log(
    "[debt] Annual GFS years/coverage, source scope, translation note, URL restore and four research views passed",
  );

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 950 });
    for (const theme of ["dark", "light"]) {
      await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
      }, theme);
      await noOverflow();
      const figure = page.locator(".debt-chart-figure-phase");
      await figure.evaluate((element) => element.scrollIntoView({ block: "center" }));
      await screenshot(`phase-${width}-${theme}`, figure);
    }
    await page.getByRole("button", { name: "选择经济体", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "选择债务比较经济体", exact: true });
    await dialog.waitFor();
    await dialog.getByLabel("搜索国家或经济体", { exact: true }).fill("GBR");
    assert.equal(await dialog.locator(".macro-country-row").count(), 1);
    const box = await dialog.boundingBox();
    assert(box.x >= 0 && box.x + box.width <= width + 1);
    await dialog.getByRole("button", { name: "完成选择", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "部门比较", exact: true }).click();
    await chartReady("structure");
    await noOverflow();
    await screenshot(`structure-${width}`, page.locator(".debt-chart-figure-structure"));
    await page.getByRole("button", { name: "信用相位", exact: true }).click();
    await chartReady("phase");
  }
  assert.deepEqual(
    requests.filter((request) =>
      /(?:CycleSpace3D|OrbitControls|\/three(?:[./_-]|$))/iu.test(new URL(request).pathname),
    ),
    [],
    "Debt exploration must not request Three.js",
  );
  assert.deepEqual(external, [], "Bundled exploration must not attempt external requests");
  assert.deepEqual(errors, [], "No uncaught exceptions or console errors");
  console.log(
    "Debt verification passed: raw BIS/PBOC/GFS values, Q/M/A cutoffs, exact baselines, precise CSV, sources, navigation, themes and mobile reflow.",
  );
} catch (error) {
  console.error(`[debt] Failed at ${page.url()}`);
  await screenshot("failure").catch(() => {});
  if (errors.length) console.error(errors);
  if (external.length) console.error({ external });
  throw error;
} finally {
  await context.close();
  await browser.close();
}
