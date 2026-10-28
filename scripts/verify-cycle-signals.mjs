import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { baseUrl, ensureShots, launchEphemeralBrowser } from "./lib/browser.mjs";

// Run against either dev or preview: BASE_URL=http://localhost:5297 node scripts/verify-cycle-signals.mjs
import {
  allCountries,
  assertCycleViewport,
  csvRows,
  display,
  displayUnit,
  exact,
  expectedHealth,
  files,
  format,
  get,
  header,
  isDerived,
  latest,
  latestEnd,
  monthIndex,
  names,
  navigateCyclePage,
  seriesFor,
  shift,
  validateExport,
} from "./lib/cycle-signals-data.mjs";

const origin = new URL(baseUrl("http://localhost:5202")).origin;
const shots = ensureShots(),
  tag = new URL(origin).port || "default";
const browser = await launchEphemeralBrowser({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce",
  colorScheme: "dark",
  acceptDownloads: true,
  serviceWorkers: "block",
});
const errors = [],
  external = [],
  requests = [];
let page;
await context.route("**/*", async (route) => {
  const url = new URL(route.request().url());
  if (["http:", "https:"].includes(url.protocol) && url.origin !== origin) {
    external.push(url.href);
    await route.abort();
  } else await route.continue();
});
await context.addInitScript(() => {
  window.__cycleSignalWebglAttempts = 0;
  const original = Reflect.get(HTMLCanvasElement.prototype, "getContext");
  HTMLCanvasElement.prototype.getContext = function (type, ...args) {
    if (/^webgl/iu.test(type)) window.__cycleSignalWebglAttempts++;
    return Reflect.apply(original, this, [type, ...args]);
  };
});
const metricSelect = () => page.getByLabel("周期趋势指标", { exact: true });
const cutoffSelect = () => page.getByLabel("周期趋势截止方式", { exact: true });
const monthSelect = () => page.getByLabel("精确选择周期月份", { exact: true });
async function waitMetric(metric) {
  await page.waitForFunction(
    (metric) =>
      new URLSearchParams(location.search).get("cycleMetric") === metric &&
      document.querySelector('[aria-label="周期趋势指标"]')?.value === metric,
    metric,
  );
  await page.locator(".cycle-chart-trend svg").waitFor();
}
async function go(metric, countries = allCountries, options = {}) {
  const params = new URLSearchParams({
    view: "macro",
    layer: "cycle",
    countries: countries.join(","),
    cycleMetric: metric,
    cycleWindow: options.window ?? "5y",
    cycleFocus: options.focus ?? countries[0],
    cycleAsOf: options.asOf ?? "latest",
    ...(options.period ? { period: options.period } : {}),
  });
  await navigateCyclePage(page, `${origin}/markets?${params}`);
  await page.locator('.cycle-atlas[data-mode="2d"] .cycle-chart-phase svg').waitFor();
  await waitMetric(metric);
}
async function selectMetric(metric) {
  await metricSelect().selectOption(metric);
  await waitMetric(metric);
}
async function assertReadout(country, metric, end) {
  const series = seriesFor(country, metric),
    point = latest(series, end);
  const readout = page
    .locator(".cycle-readouts > div")
    .filter({ has: page.locator("span", { hasText: new RegExp(`^${names[country]}$`, "u") }) });
  assert.equal(
    await readout.locator("strong").innerText(),
    format(series && point ? display(series, point) : null, series ? displayUnit(series) : "index"),
  );
  if (point)
    assert(
      (await readout.locator("small").innerText()).includes(point.period),
      `${country} readout reports its actual observation period`,
    );
}
async function sourceDialog() {
  await page.getByRole("button", { name: "周期数据说明", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "周期数据 · 来源与覆盖", exact: true });
  await dialog.waitFor();
  return dialog;
}
async function closeDialog(dialog) {
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
}
async function exportCsv(metric, countries, end, window = "5y") {
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出周期 CSV", exact: true }).click();
  const download = await event;
  assert.equal(download.suggestedFilename(), `cycle-${metric}-${end}.csv`);
  await download.saveAs(path.join(shots, `cycle-signals-${tag}-${metric}.csv`));
  const rows = csvRows(await readFile(await download.path(), "utf8"));
  assert.deepEqual(rows.shift(), header);
  validateExport(rows, metric, countries, end, window);
  return rows;
}
async function assertHealth(metric, countries, end, window = "5y") {
  const details = page.locator("details.cycle-health");
  if ((await details.getAttribute("open")) === null) await details.locator("summary").click();
  const start = window === "all" ? "2000-01" : shift(end, window === "10y" ? -119 : -59);
  assert((await details.innerText()).includes(`截止 ${end}`));
  assert((await details.innerText()).includes("不是发布延迟"));
  for (const country of countries) {
    const row = details
      .locator("tbody tr")
      .filter({ has: page.locator("th", { hasText: new RegExp(`^${names[country]}$`, "u") }) });
    const cells = await row.locator("td").allTextContents(),
      expected = expectedHealth(country, metric, start, end);
    if (!expected) {
      assert.equal(cells[0], "未收录");
      continue;
    }
    assert(cells[0].startsWith(expected.latest));
    assert.equal(cells[1], expected.age);
    assert.equal(cells[2], expected.coverage);
    assert.equal(cells[3], expected.sourceUpdatedAt);
    if (isDerived(metric)) assert(cells[0].includes("计算值"));
  }
}
async function assertTable(metric, rows) {
  await page.getByRole("button", { name: "查看周期数据表", exact: true }).click();
  const dialog = page.getByRole("dialog").filter({ hasText: "原始期次数据表" });
  await dialog.waitFor();
  for (const country of new Set(rows.map((row) => row[0]))) {
    const expected = rows.filter((row) => row[0] === country).reverse(),
      table = dialog.getByLabel(`${country} 周期数据表`, { exact: true });
    assert.deepEqual(
      await table.locator("tbody th").allTextContents(),
      expected.map((row) => row[2]),
    );
    const first = table.locator("tbody tr").first();
    assert.equal(
      await first.locator("td").first().innerText(),
      format(expected[0][3] === "" ? null : Number(expected[0][3]), expected[0][4]),
    );
  }
  assert((await dialog.innerText()).includes("完整来源"));
  await closeDialog(dialog);
}
async function noExternalOrThree() {
  assert.deepEqual(external, [], "Bundled exploration makes no external requests");
  assert(
    !requests.some((url) => /(?:\/three[/.]|three\.module|CycleSpace3D|OrbitControls)/iu.test(url)),
    "2D signal exploration does not load Three.js",
  );
  assert.equal(await page.locator('canvas[data-renderer="webgl2"]').count(), 0);
  assert.equal(await page.evaluate(() => window.__cycleSignalWebglAttempts), 0);
}

try {
  page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("request", (request) => requests.push(request.url()));
  await go("cli");
  const groups = {
    实体与景气: "cli",
    政策传导: "policyRate",
    房地产: "realHousePrices",
    就业边际: "payrollChange",
    贷款供需: "loanStandards",
    价格动量: "coreInflation3m",
    增长与预期: "privateDemandGrowth",
  };
  const nav = page.getByRole("navigation", { name: "周期信号类别", exact: true });
  assert.equal(await nav.getByRole("button").count(), 7);
  for (const [group, metric] of Object.entries(groups)) {
    await nav.getByRole("button", { name: group, exact: true }).click();
    await waitMetric(metric);
    assert.equal(
      await nav.getByRole("button", { name: group, exact: true }).getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(await cutoffSelect().inputValue(), "latest");
    assert.equal(
      await page.locator('.cycle-signal-choices button[aria-pressed="true"]').count(),
      1,
    );
  }
  await selectMetric("buildingPermits");
  await noExternalOrThree();
  console.log(
    "[cycle-signals] Seven signal groups, selected metric and independent latest cutoff passed",
  );

  await go("policyRate");
  const policyEnd = latestEnd(allCountries, "policyRate");
  for (const country of allCountries) {
    assert(get(country, "policyRate"), `Policy rate present: ${country}`);
    await assertReadout(country, "policyRate", policyEnd);
  }
  const policies = await exportCsv("policyRate", allCountries, policyEnd);
  await assertHealth("policyRate", allCountries, policyEnd);
  assert(
    get("CHN", "policyRate").note.includes("LPR") &&
      get("DEU", "policyRate").note.includes("欧元区"),
  );
  const jp = get("JPN", "policyRate");
  assert(jp.note.includes("缺口"));
  assert(
    jp.observations.some(
      (point, i, all) =>
        point.value === null ||
        (i > 0 && monthIndex(point.period) - monthIndex(all[i - 1].period) > 1),
    ),
    "Japan policy history retains missing periods",
  );
  const sources = await sourceDialog();
  const text = await sources.innerText();
  assert(
    text.includes("当前修订版历史数据") &&
      text.includes("LPR") &&
      text.includes("欧元区") &&
      text.includes("未披露") &&
      text.includes("计算值"),
  );
  const links = await sources
    .locator(".cycle-source-item a")
    .evaluateAll((nodes) =>
      nodes.map((node) => ({ href: node.href, target: node.target, rel: node.rel })),
    );
  assert(
    links.length > 20 &&
      links.every(
        (link) =>
          link.href.startsWith("https://") &&
          link.target === "_blank" &&
          link.rel.includes("noopener"),
      ),
  );
  await closeDialog(sources);
  await assertTable("policyRate", policies);
  await go("policyRate", ["JPN"], { window: "all" });
  const jpRows = await exportCsv("policyRate", ["JPN"], latestEnd(["JPN"], "policyRate"), "all");
  for (const [before, after] of jp.observations
    .slice(1)
    .map((point, i) => [jp.observations[i], point]))
    if (monthIndex(after.period) - monthIndex(before.period) > 1)
      assert(
        !jpRows.some((row) => row[2] > before.period && row[2] < after.period),
        "Japan's missing policy periods are not filled",
      );
  await go("realPolicyRate");
  const realEnd = latestEnd(allCountries, "realPolicyRate");
  const realRates = await exportCsv("realPolicyRate", allCountries, realEnd);
  assert(
    realRates.every(
      (row) =>
        row[16].includes(get(row[0], "policyRate").source.url) &&
        row[16].includes(get(row[0], "inflation").source.url),
    ),
  );
  console.log(
    "[cycle-signals] Five policy tools, Japan gaps, real-rate inputs and full provenance passed",
  );

  await go("realHousePrices");
  const houseEnd = latestEnd(allCountries, "realHousePrices");
  const houses = await exportCsv("realHousePrices", allCountries, houseEnd);
  assert(
    houses.length > 20 && houses.every((row) => row[7] === "Q" && /^\d{4}-Q[1-4]$/u.test(row[2])),
  );
  await assertTable("realHousePrices", houses);
  await assertHealth("realHousePrices", allCountries, houseEnd);
  for (const metric of ["housingStarts", "buildingPermits", "loanStandards", "loanDemand"]) {
    await go(metric, ["USA"]);
    const end = latestEnd(["USA"], metric);
    await assertReadout("USA", metric, end);
    const rows = await exportCsv(metric, ["USA"], end);
    await assertHealth(metric, ["USA"], end);
    if (metric.startsWith("loan")) {
      assert(rows.every((row) => row[7] === "Q" && row[8] === "NSA"));
      assert(
        rows.at(-1)[16].includes(metric === "loanStandards" ? "正值表示净收紧" : "正值表示净增强"),
      );
      if (metric === "loanStandards") {
        const zero = rows.find((row) => row[2] === "2026-Q3");
        assert(zero && zero[3] === "0");
        assert.equal(await page.locator(".cycle-readouts strong").innerText(), "0%");
      } else assert(Number(rows.at(-1)[3]) > 0);
    } else {
      assert(
        rows.every(
          (row) =>
            row[6] === "thousandUnits" && row[16].includes("SAAR") && row[16].includes("未除以 12"),
        ),
      );
      assert((await page.locator(".cycle-readouts strong").innerText()).includes("千套"));
    }
  }
  console.log(
    "[cycle-signals] Native quarterly house prices, housing SAAR levels, SLOOS zero and demand sign passed",
  );

  for (const metric of ["coreInflation3m", "payrollChange", "unemploymentGap"]) {
    await go(metric, ["USA"], { window: "all" });
    const end = latestEnd(["USA"], metric),
      rows = await exportCsv(metric, ["USA"], end, "all");
    await assertReadout("USA", metric, end);
    await assertHealth(metric, ["USA"], end, "all");
    assert(
      rows.some((row) => row[3] !== ""),
      `${metric} has usable derived observations`,
    );
    if (metric === "coreInflation3m") {
      const gap = get("USA", "corePriceIndex").observations.find((point) => point.value === null);
      assert(gap, "Real CPI resource contains a missing month");
      for (let i = 0; i < 4; i++)
        assert.equal(
          rows.find((row) => row[2] === shift(gap.period, i))?.[3],
          "",
          "Missing index invalidates all affected four-month windows",
        );
    }
    if (metric === "payrollChange") {
      assert.equal(rows[0][3], "");
      assert(rows.every((row) => row[4] === "thousandPersons"));
      assert((await page.locator(".cycle-readouts strong").innerText()).includes("千人"));
    }
    if (metric === "unemploymentGap") {
      assert(
        rows.slice(0, 13).every((row) => row[3] === ""),
        "No gap statistic before fourteen consecutive input months",
      );
      assert(
        rows.every(
          (row) =>
            row[4] === "percentagePoints" &&
            row[16].includes("14个连续有效月份") &&
            row[16].includes("不是实时萨姆"),
        ),
      );
    }
  }
  console.log(
    "[cycle-signals] Independent exact-month core3m, payroll changes and fourteen-month descriptive unemployment gap passed",
  );

  await go("jobOpenings", ["USA"], { period: "2025-06", asOf: "period" });
  await assertReadout("USA", "jobOpenings", "2025-06");
  const selected = await exportCsv("jobOpenings", ["USA"], "2025-06");
  assert(selected.every((row) => row[2] <= "2025-06"));
  await cutoffSelect().selectOption("latest");
  await page.waitForFunction(
    () => new URLSearchParams(location.search).get("cycleAsOf") === "latest",
  );
  const jobsEnd = latestEnd(["USA"], "jobOpenings");
  await assertReadout("USA", "jobOpenings", jobsEnd);
  const later = await exportCsv("jobOpenings", ["USA"], jobsEnd);
  assert(later.at(-1)[2] > selected.at(-1)[2]);
  const saved = page.url();
  await page.reload({ waitUntil: "networkidle" });
  await waitMetric("jobOpenings");
  assert.equal(page.url(), saved);
  assert.equal(await cutoffSelect().inputValue(), "latest");
  assert.equal(await monthSelect().inputValue(), "2025-06");
  await page.getByRole("button", { name: "播放周期轨迹", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('[aria-label="周期趋势截止方式"]')?.value === "period",
  );
  await page.waitForFunction(
    () => document.querySelector(".cycle-atlas")?.getAttribute("data-period") !== "2025-06",
  );
  await page.getByRole("button", { name: "暂停周期回放", exact: true }).click();
  const replayMonth = await monthSelect().inputValue();
  await assertReadout("USA", "jobOpenings", replayMonth);
  assert.notEqual(new URL(page.url()).searchParams.get("cycleAsOf"), "latest");
  await go("initialClaims", ["USA"]);
  await assertHealth("initialClaims", ["USA"], latestEnd(["USA"], "initialClaims"));
  console.log(
    "[cycle-signals] Selected/latest cutoffs, replay reset, URL restore and weekly coverage semantics passed",
  );

  for (const metric of [
    "industrialProduction",
    "retailNominal",
    "unemployment",
    "housingSalesYtd",
    "housingStartsYtd",
    "realEstateInvestmentYtd",
  ]) {
    const series = get("CHN", metric);
    assert(series, `China activity resource integrated: ${metric}`);
    await go(metric, ["CHN"]);
    const end = latestEnd(["CHN"], metric),
      rows = await exportCsv(metric, ["CHN"], end);
    await assertReadout("CHN", metric, end);
    assert.equal(series.unit, "percent");
    assert.equal(series.frequency, "M");
    if (metric.endsWith("Ytd")) assert(rows.every((row) => row[16].includes("累计")));
    if (metric === "retailNominal") {
      assert(series.note.includes("名义") && !series.note.includes("实际零售量指数"));
      assert((await page.locator(".cycle-description").innerText()).includes("名义"));
    }
    if (metric === "unemployment")
      assert(/调查/u.test(series.note), "China employment keeps surveyed-unemployment scope");
    if (["industrialProduction", "retailNominal"].includes(metric))
      assert.equal(
        exact(series, `${end.slice(0, 4)}-02`),
        null,
        "Jan-Feb combined activity is not a February single-month observation",
      );
  }
  for (const metric of ["businessConfidence", "consumerConfidence"]) {
    assert(
      allCountries.some((country) => get(country, metric)),
      `${metric} is backed by a bundled source`,
    );
    await go(metric);
    await exportCsv(metric, allCountries, latestEnd(allCountries, metric));
  }
  console.log(
    "[cycle-signals] China monthly versus nominal/YTD/survey scopes and confidence sources passed",
  );

  for (const theme of ["dark", "light"])
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await go("loanStandards");
      await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
      }, theme);
      await assertHealth("loanStandards", allCountries, latestEnd(allCountries, "loanStandards"));
      await assertCycleViewport(page);
      await page.locator(".cycle-trend-panel").scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(shots, `cycle-signals-${tag}-${theme}-${width}.png`),
      });
      const source = await sourceDialog();
      await assertCycleViewport(page);
      await closeDialog(source);
      await page.getByRole("button", { name: "查看周期数据表", exact: true }).click();
      const table = page.getByRole("dialog").filter({ hasText: "原始期次数据表" });
      await table.waitFor();
      await assertCycleViewport(page);
      await closeDialog(table);
      if (width < 500) {
        await page.getByRole("button", { name: "选择经济体", exact: true }).click();
        const chooser = page.getByRole("dialog", { name: "选择周期比较经济体", exact: true });
        await chooser.waitFor();
        await assertCycleViewport(page);
        await chooser.getByRole("button", { name: "完成选择", exact: true }).click();
        await chooser.waitFor({ state: "hidden" });
      }
    }
  await noExternalOrThree();
  assert.deepEqual(errors, [], "No runtime or console errors");
  console.log(
    `[cycle-signals] PASS ${origin}: ${files.length} real resources; seven groups; raw/derived values, units, dates, coverage, CSV, cutoffs, URL, themes and mobile reflow; no external data or Three.js`,
  );
} catch (error) {
  if (page) {
    console.error(`[cycle-signals] Failed at ${page.url()}`);
    await page
      .screenshot({ path: path.join(shots, `cycle-signals-${tag}-failure.png`) })
      .catch(() => {});
  }
  if (errors.length) console.error({ errors });
  if (external.length) console.error({ external });
  throw error;
} finally {
  await context.close();
  await browser.close();
}
