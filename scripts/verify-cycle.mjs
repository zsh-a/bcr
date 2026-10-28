import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { baseUrl, ensureShots, launchEphemeralBrowser } from "./lib/browser.mjs";

const origin = new URL(baseUrl("http://localhost:5202")).origin;
const url = `${origin}/markets?view=macro&layer=cycle`;
const shots = ensureShots();
// Compare against the shipped official resource; never substitute browser fixtures.
const oecd = JSON.parse(
  await readFile(
    new URL("../packages/market-data/src/cycle/oecd-snapshot.json", import.meta.url),
    "utf8",
  ),
);
const number = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
const browser = await launchEphemeralBrowser({
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const contexts = [],
  errors = [],
  external = [],
  requests = [];
/** @type {import("playwright").Page | undefined} */
let currentPage;

async function createPage(options = {}, denyWebGL = false) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 2,
    reducedMotion: "reduce",
    colorScheme: "dark",
    acceptDownloads: true,
    ...options,
  });
  contexts.push(context);
  // Bundled exploration must not contact a data provider, font CDN or texture host.
  await context.route("**/*", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (["http:", "https:"].includes(requestUrl.protocol) && requestUrl.origin !== origin) {
      external.push(requestUrl.href);
      await route.abort();
    } else await route.continue();
  });
  if (denyWebGL)
    await context.addInitScript(() => {
      window.__cycleDeniedContexts = 0;
      const original = Reflect.get(HTMLCanvasElement.prototype, "getContext");
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        if (type === "webgl2") {
          window.__cycleDeniedContexts++;
          return null;
        }
        return Reflect.apply(original, this, [type, ...args]);
      };
    });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.on("pageerror", (error) => errors.push(`${page.url()}: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`${page.url()}: ${message.text()}`);
  });
  page.on("request", (request) => requests.push(request.url()));
  currentPage = page;
  return page;
}
const atlas = (page) => page.locator(".cycle-atlas");
const monthSelect = (page) => page.getByLabel("精确选择周期月份", { exact: true });
const card = (page, id) => page.locator(".cycle-country-card").filter({ hasText: id });
const canvas = (page) => page.locator('canvas[data-renderer="webgl2"]');
const frameCount = async (page) => Number(await canvas(page).getAttribute("data-render-count"));
const currentPeriod = (page) => atlas(page).getAttribute("data-period");
async function waitParam(page, key, value) {
  await page.waitForFunction(
    ([key, value]) => new URLSearchParams(location.search).get(key) === value,
    [key, value],
  );
}
async function waitPeriod(page, period) {
  await page.waitForFunction(
    (period) =>
      document.querySelector(".cycle-atlas")?.getAttribute("data-period") === period &&
      document.querySelector('[aria-label="精确选择周期月份"]')?.value === period,
    period,
  );
}
async function phaseReady(page) {
  await page.locator('.cycle-atlas[data-mode="2d"] .cycle-chart-phase svg').waitFor();
  await page.locator(".cycle-chart-trend svg").waitFor();
}
async function rendererReady(page) {
  await canvas(page).scrollIntoViewIfNeeded();
  await page.locator('.cycle-space[data-renderer-state="ready"]').waitFor();
  await page.waitForFunction(
    () => Number(document.querySelector('canvas[data-renderer="webgl2"]')?.dataset.renderCount) > 0,
  );
}
async function drewAfter(page, count) {
  await page.waitForFunction(
    (previous) =>
      Number(document.querySelector('canvas[data-renderer="webgl2"]')?.dataset.renderCount) >
      previous,
    count,
  );
}
async function changeTheme(page, theme) {
  const previous = await page
    .locator(".cycle-space")
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  const picker = page.getByRole("combobox", { name: "外观主题", exact: true });
  if (await picker.count()) await picker.selectOption(theme);
  else
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, theme);
  // A pending keyboard/resize frame can complete before the theme is applied.
  await page.waitForFunction(
    ([theme, previous]) =>
      document.documentElement.dataset.theme === theme &&
      getComputedStyle(document.querySelector(".cycle-space")).backgroundColor !== previous,
    [theme, previous],
  );
}
async function noOverflow(page) {
  await page.waitForFunction(
    () =>
      document.documentElement.scrollWidth <= innerWidth + 1 &&
      [
        ...document.querySelectorAll(".cycle-atlas, .macro-main, .macro-chart-panel, .cycle-space"),
      ].every((element) => element.scrollWidth <= element.clientWidth + 1),
    null,
    { timeout: 5000 },
  );
}
function cli(id, period) {
  const series = oecd.series.find((series) => series.country === id && series.indicator === "cli");
  const observation = series?.observations.find((point) => point.period === period);
  assert(
    series && observation && observation.value !== null,
    `Official CLI exists: ${id} ${period}`,
  );
  return { series, observation };
}
async function assertCli(page, id, period) {
  const { observation } = cli(id, period);
  assert.equal(
    await card(page, id).locator(":scope > strong").innerText(),
    number.format(observation.value),
  );
  const previous = new Date(`${period}-01T00:00:00Z`);
  previous.setUTCMonth(previous.getUTCMonth() - 3);
  const momentum =
    observation.value - cli(id, previous.toISOString().slice(0, 7)).observation.value;
  assert(
    (await card(page, id).locator(".cycle-card-momentum").innerText()).includes(
      `Δ3M ${momentum >= 0 ? "+" : ""}${momentum.toFixed(2)}`,
    ),
  );
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
function noThreeBeforeSelection() {
  assert.deepEqual(
    requests.filter((request) =>
      /(?:CycleSpace3D|OrbitControls|\/three(?:[./_-]|$))/iu.test(new URL(request).pathname),
    ),
    [],
    "Default 2D exploration must not request Three.js",
  );
}

try {
  const page = await createPage();
  await page.goto(url, { waitUntil: "networkidle" });
  await phaseReady(page);
  assert.equal(await atlas(page).getAttribute("data-mode"), "2d");
  assert.equal(
    await page.getByRole("button", { name: "二维相位", exact: true }).getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(await canvas(page).count(), 0);
  assert.equal(await page.locator(".cycle-country-card").count(), 4);
  assert((await page.locator(".cycle-chart-phase svg").textContent()).includes("CLI"));
  assert((await page.locator(".cycle-chart-phase svg").textContent()).includes("三个月变化"));
  const latest = await currentPeriod(page);
  for (const id of ["CHN", "USA", "JPN", "DEU"]) await assertCli(page, id, latest);
  noThreeBeforeSelection();
  await noOverflow(page);
  console.log("[cycle] Default SVG phase chart, official CLI/Δ3M and lazy Three.js passed");

  await card(page, "USA").press("Enter");
  await waitParam(page, "cycleFocus", "USA");
  assert.equal(await card(page, "USA").getAttribute("aria-pressed"), "true");
  assert.equal(await page.locator('.cycle-country-card[aria-pressed="true"]').count(), 1);
  await page.getByRole("heading", { name: "美国 · 周期分项", exact: true }).waitFor();
  const britain = page.locator(".macro-sidebar .macro-country-row").filter({ hasText: "GBR" });
  await britain.click();
  await page.waitForFunction(() => document.querySelectorAll(".cycle-country-card").length === 5);
  assert.equal(await britain.getAttribute("aria-pressed"), "true");
  await assertCli(page, "GBR", await currentPeriod(page));
  await page.getByLabel("周期趋势指标", { exact: true }).selectOption("unemployment");
  await waitParam(page, "cycleMetric", "unemployment");
  assert.equal(await page.locator(".cycle-readouts > div").count(), 5);
  assert((await page.locator(".cycle-description").innerText()).includes("失业率"));
  await page.getByLabel("周期趋势指标", { exact: true }).selectOption("cli");
  await waitParam(page, "cycleMetric", "cli");
  const windowSelect = page.getByLabel("周期回放窗口", { exact: true });
  await windowSelect.selectOption("10y");
  await waitParam(page, "cycleWindow", "10y");
  await page.waitForFunction(
    () => document.querySelector('[aria-label="精确选择周期月份"]')?.options.length === 120,
  );
  await windowSelect.selectOption("all");
  await waitParam(page, "cycleWindow", "all");
  await page.waitForFunction(
    () => document.querySelector('[aria-label="精确选择周期月份"]')?.options.length > 120,
  );
  const fullPeriods = await monthSelect(page)
    .locator("option")
    .evaluateAll((options) => options.map((option) => option.value));
  assert(fullPeriods.length > 120 && fullPeriods[0] < "2010-01");
  await windowSelect.selectOption("5y");
  await waitParam(page, "cycleWindow", "5y");
  await page.waitForFunction(
    () => document.querySelector('[aria-label="精确选择周期月份"]')?.options.length === 60,
  );
  const periods = await monthSelect(page)
    .locator("option")
    .evaluateAll((options) => options.map((option) => option.value));
  await monthSelect(page).selectOption(periods.at(-5));
  await waitPeriod(page, periods.at(-5));
  await assertCli(page, "USA", periods.at(-5));
  await page.getByLabel("周期观察月份", { exact: true }).press("ArrowLeft");
  await waitPeriod(page, periods.at(-6));
  await page.getByRole("button", { name: "播放周期轨迹", exact: true }).click();
  await page.waitForFunction(
    (before) => document.querySelector(".cycle-atlas")?.getAttribute("data-period") !== before,
    periods.at(-6),
  );
  await page.getByRole("button", { name: "暂停周期回放", exact: true }).click();
  const pausedPeriod = await currentPeriod(page);
  await page.waitForTimeout(1250);
  assert.equal(await currentPeriod(page), pausedPeriod, "Paused playback must stop advancing");
  const stateUrl = page.url();
  await page.reload({ waitUntil: "networkidle" });
  await phaseReady(page);
  assert.equal(page.url(), stateUrl);
  assert.equal(await currentPeriod(page), pausedPeriod);
  assert.equal(await card(page, "USA").getAttribute("aria-pressed"), "true");
  console.log(
    "[cycle] Country selection/focus, metric, window, month, playback and URL restore passed",
  );

  await page.getByRole("button", { name: "周期数据说明", exact: true }).click();
  const sources = page.getByRole("dialog", { name: "周期数据 · 来源与覆盖", exact: true });
  await sources.waitFor();
  assert((await sources.innerText()).includes("当前修订版历史数据"));
  assert((await sources.locator(".cycle-source-item").count()) >= 5);
  const links = await sources
    .locator("a")
    .evaluateAll((links) =>
      links.map((link) => ({ href: link.href, target: link.target, rel: link.rel })),
    );
  assert(
    links.length > 5 &&
      links.every(
        (link) =>
          link.href.startsWith("https://") &&
          link.target === "_blank" &&
          link.rel.includes("noopener"),
      ),
  );
  await page.keyboard.press("Escape");
  await sources.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "查看周期数据表", exact: true }).click();
  const table = page.getByRole("dialog", {
    name: "综合领先指标 CLI · 原始期次数据表",
    exact: true,
  });
  await table.waitFor();
  const latestRow = table.getByLabel("USA 周期数据表", { exact: true }).locator("tbody tr").first();
  assert.equal(await latestRow.locator("th").innerText(), pausedPeriod);
  assert.equal(
    await latestRow.locator("td").nth(0).innerText(),
    number.format(cli("USA", pausedPeriod).observation.value),
  );
  assert.equal(
    await latestRow.locator("td").nth(1).innerText(),
    number.format(cli("USA", pausedPeriod).observation.value),
  );
  await page.keyboard.press("Escape");
  await table.waitFor({ state: "hidden" });
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出周期 CSV", exact: true }).click();
  const download = await downloadEvent;
  assert.equal(download.suggestedFilename(), `cycle-cli-${pausedPeriod}.csv`);
  await download.saveAs(`${shots}/cycle-export.csv`);
  const rows = csvRows(await readFile(await download.path(), "utf8"));
  assert.deepEqual(rows[0], [
    "country",
    "indicator",
    "period",
    "display_value",
    "display_unit",
    "raw_value",
    "raw_unit",
    "frequency",
    "seasonal_adjustment",
    "status",
    "source",
    "series_code",
    "source_url",
    "fetched_at",
    "source_updated_at",
    "license_url",
    "note",
  ]);
  const exported = rows.find(
    (row) => row[0] === "USA" && row[1] === "cli" && row[2] === pausedPeriod,
  );
  assert(exported, "CSV contains the selected official observation");
  const expected = cli("USA", pausedPeriod);
  assert.equal(Number(exported[3]), expected.observation.value);
  assert.equal(Number(exported[5]), expected.observation.value);
  assert.equal(exported[4], "index");
  assert.equal(exported[6], "index");
  assert.equal(exported[7], "M");
  assert.equal(exported[12], expected.series.source.url);
  assert.equal(exported[14], expected.series.sourceUpdatedAt ?? "");
  noThreeBeforeSelection();
  assert.deepEqual(external, []);
  await page.locator(".cycle-chart-phase").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shots}/cycle-2d-desktop.png` });
  console.log("[cycle] Source coverage, native table and provenance-preserving local CSV passed");

  await page.getByRole("button", { name: "三维周期空间", exact: true }).click();
  await rendererReady(page);
  const originalCanvas = await canvas(page).elementHandle();
  const pixels = await canvas(page).evaluate((element) => ({
    width: element.width,
    cssWidth: element.clientWidth,
  }));
  assert(
    pixels.width > 0 && pixels.width / pixels.cssWidth <= 1.51,
    "Renderer caps device pixel ratio",
  );
  await page.waitForTimeout(200);
  const idle = await frameCount(page);
  await page.waitForTimeout(450);
  assert.equal(await frameCount(page), idle, "No idle RAF rendering");
  await monthSelect(page).selectOption(periods.at(-2));
  await waitPeriod(page, periods.at(-2));
  await rendererReady(page);
  assert(
    await canvas(page).evaluate((element, previous) => element === previous, originalCanvas),
    "Changing the month must retain the same canvas/context",
  );
  await drewAfter(page, idle);
  assert.equal(await page.locator(".cycle-space-detail strong").innerText(), "美国");
  assert.equal(
    await page.locator(".cycle-space-detail dd").first().innerText(),
    cli("USA", periods.at(-2)).observation.value.toFixed(2),
  );
  let count = await frameCount(page);
  await canvas(page).press("ArrowRight");
  await drewAfter(page, count);
  count = await frameCount(page);
  await canvas(page).press("Home");
  await drewAfter(page, count);
  count = await frameCount(page);
  const darkSurface = await page
    .locator(".cycle-space")
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  await changeTheme(page, "light");
  await drewAfter(page, count);
  assert.notEqual(
    await page
      .locator(".cycle-space")
      .evaluate((element) => getComputedStyle(element).backgroundColor),
    darkSurface,
    "Theme changes canvas chrome colors",
  );
  await page.screenshot({ path: `${shots}/cycle-3d-light.png` });
  count = await frameCount(page);
  await changeTheme(page, "dark");
  await drewAfter(page, count);
  assert(
    await canvas(page).evaluate((element, previous) => element === previous, originalCanvas),
    "Theme updates must retain the same canvas/context",
  );
  await page.screenshot({ path: `${shots}/cycle-3d-desktop.png` });
  await page.setViewportSize({ width: 1440, height: 700 });
  await page
    .locator(".macro-page-footer")
    .evaluate((element) => element.scrollIntoView({ block: "start" }));
  await page.locator('.cycle-space[data-renderer-state="paused"]').waitFor();
  const offscreen = await frameCount(page);
  await page.waitForTimeout(450);
  assert.equal(await frameCount(page), offscreen, "Offscreen canvas must stop drawing");
  await rendererReady(page);
  console.log(
    "[cycle] 3D lazy mount, demand frames, stable context, keyboard, theme and offscreen pause passed",
  );

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await rendererReady(page);
    await noOverflow(page);
    await page.screenshot({ path: `${shots}/cycle-3d-${width}.png` });
    await page.getByRole("button", { name: "二维相位", exact: true }).click();
    await phaseReady(page);
    await noOverflow(page);
    await page.getByRole("button", { name: "选择经济体", exact: true }).click();
    const chooser = page.getByRole("dialog", { name: "选择周期比较经济体", exact: true });
    await chooser.waitFor();
    await chooser.getByLabel("搜索国家或经济体", { exact: true }).fill("GBR");
    assert.equal(await chooser.locator(".macro-country-row").count(), 1);
    assert.equal(await chooser.locator(".macro-country-row").getAttribute("aria-pressed"), "true");
    await chooser.getByRole("button", { name: "完成选择", exact: true }).click();
    await chooser.waitFor({ state: "hidden" });
    await noOverflow(page);
    await page.screenshot({ path: `${shots}/cycle-2d-${width}.png` });
    if (width === 390) {
      await page.getByRole("button", { name: "三维周期空间", exact: true }).click();
      await rendererReady(page);
    }
  }
  console.log("[cycle] 390px and 320px 2D/3D reflow and country chooser passed");

  const fallback = await createPage({}, true);
  await fallback.goto(`${url}&cycleMode=3d`, { waitUntil: "networkidle" });
  const unavailable = fallback.locator('.cycle-space[data-renderer-state="unavailable"]');
  await unavailable.waitFor();
  await unavailable.scrollIntoViewIfNeeded();
  assert((await unavailable.locator(".cycle-space-fallback").innerText()).includes("WebGL2"));
  assert.equal(await canvas(fallback).count(), 0);
  const denied = await fallback.evaluate(() => window.__cycleDeniedContexts);
  await fallback.getByRole("button", { name: "重新尝试", exact: true }).click();
  await fallback.waitForFunction((before) => window.__cycleDeniedContexts > before, denied);
  await unavailable.waitFor();
  await fallback.getByRole("button", { name: "二维相位", exact: true }).click();
  await phaseReady(fallback);
  assert.equal(await fallback.locator(".cycle-space-fallback").count(), 0);
  assert.deepEqual(external, [], "All interactions remain within bundled project resources");
  assert.deepEqual(errors, [], "No uncaught exceptions or console errors");
  console.log(
    "Cycle verification passed: official bundled values, SVG-first loading, controls, local CSV, demand-driven WebGL2, themes, mobile reflow and unavailable-WebGL fallback.",
  );
} catch (error) {
  console.error(`[cycle] Failed at ${currentPage?.url() ?? url}`);
  if (currentPage)
    await currentPage.screenshot({ path: `${shots}/cycle-failure.png` }).catch(() => {});
  if (errors.length) console.error(errors);
  if (external.length) console.error({ external });
  throw error;
} finally {
  await Promise.all(contexts.map((context) => context.close()));
  await browser.close();
}
