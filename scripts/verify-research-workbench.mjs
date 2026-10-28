import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { baseUrl, ensureShots, launchEphemeralBrowser } from "./lib/browser.mjs";
import {
  assertPanelReading,
  assertSharedCursor,
  assertViewport,
  csvRows,
  format,
  latest,
  maxDate,
  seriesFor,
  validateCsv,
  within,
} from "./lib/research-workbench-checks.mjs";

const origin = new URL(baseUrl("http://localhost:5202")).origin;
const host = new URL(origin).port,
  shots = ensureShots();
const browser = await launchEphemeralBrowser({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1050 },
  reducedMotion: "reduce",
  colorScheme: "dark",
  acceptDownloads: true,
});
await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
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
const workbench = () => page.locator(".research-workbench");
const panel = (metric) => page.locator(`.research-panel[data-metric="${metric}"]`);
const dialog = () => page.locator("dialog[open]");
const query = () => new URL(page.url()).searchParams;
const three = () =>
  requests.filter((url) =>
    /(?:\/|_|\b)(?:three|CycleSpace3D|ResearchSpace)(?:[./_?]|\b)/u.test(url),
  );
const conditionKeys = ["countries", "rFocus", "rFrom", "rTo", "rDate", "rAsOf", "rPins", "rEvent"];
const conditions = () => Object.fromEntries(conditionKeys.map((key) => [key, query().get(key)]));
const routeUrl = (patch = {}) =>
  `${origin}/markets?${new URLSearchParams({ view: "macro", layer: "research", countries: "USA,JPN", rFocus: "USA", rFrom: "2024-01-01", rTo: maxDate, rDate: maxDate, rAsOf: "latest", rPreset: "overview", rPins: "", ...patch })}`;
async function ready() {
  await workbench().waitFor();
  await page.waitForFunction(
    () => document.querySelector(".research-workbench")?.getAttribute("aria-busy") === "false",
  );
  await page.locator(".research-panel").first().waitFor();
}
async function navigate(url) {
  await page.evaluate((next) => {
    history.pushState(null, "", next);
    dispatchEvent(new PopStateEvent("popstate"));
  }, url);
  await ready();
  const expected = new URL(url).searchParams;
  await page.waitForFunction(
    ([preset, cutoff]) => {
      const node = document.querySelector(".research-workbench");
      return node?.dataset.preset === preset && node.dataset.cutoff === cutoff;
    },
    [
      expected.get("rPreset"),
      expected.get("rAsOf") === "date"
        ? [expected.get("rTo"), expected.get("rDate")].sort((a, b) => a.localeCompare(b))[0]
        : expected.get("rTo"),
    ],
  );
}
async function waitParam(key, value) {
  await page.waitForFunction(
    ([key, value]) => new URLSearchParams(location.search).get(key) === value,
    [key, value],
  );
  await ready();
}
async function closeDialog() {
  await dialog().getByRole("button", { name: "关闭", exact: true }).click();
  await dialog().waitFor({ state: "hidden" });
}
async function inspect(metric, tab) {
  await panel(metric).locator(".research-metric-title").click();
  await dialog().waitFor();
  if (tab) await dialog().getByRole("button", { name: tab, exact: true }).click();
}
async function exportCsv(button, name) {
  const pending = page.waitForEvent("download");
  await button.click();
  const download = await pending;
  assert(download.suggestedFilename().endsWith(".csv"));
  await download.saveAs(`${shots}/research-${host}-${name}.csv`);
  return csvRows(await readFile(await download.path(), "utf8"));
}
const assertReading = (...args) => assertPanelReading(page, ...args);
const assertCursor = (date) => assertSharedCursor(page, date);
async function step(name, action) {
  console.log(`[research:${host}] ${name}`);
  await action();
}
try {
  await page.goto(`${origin}/markets?view=macro`, { waitUntil: "domcontentloaded" });
  await ready();
  await step("default eight panels, six matrix metrics and seven themes", async () => {
    assert.equal(await page.locator(".research-panel").count(), 8);
    assert.equal(await page.locator(".research-matrix thead th").count(), 7);
    assert.equal(
      await page.getByRole("navigation", { name: "宏观研究主题" }).getByRole("button").count(),
      7,
    );
    await assertViewport(page);
    assert.deepEqual(three(), [], "Three.js stays unloaded on the two-dimensional workbench");
  });
  await step("native annual GDP, monthly CPI, quarterly DSR and a real zero", async () => {
    await navigate(routeUrl({ rPins: "annual:gdp,cycle:loanStandards" }));
    for (const metric of [
      "annual:gdp",
      "cycle:inflation",
      "debt:debtService",
      "cycle:loanStandards",
    ])
      await assertReading(metric, "USA", maxDate);
    assert.equal(
      await panel("cycle:loanStandards").locator(".research-panel-reading > strong").innerText(),
      "0%",
    );
    const matrix = page.getByRole("button", { name: "USA annual:gdp 查看数据", exact: true });
    const annual = seriesFor("USA", "annual:gdp"),
      point = latest(annual, maxDate);
    assert.equal(await matrix.locator("strong").innerText(), format(point.value, annual.unit));
    assert.equal(await matrix.locator("small").innerText(), point.period);
  });
  await step("theme and pin changes retain shared conditions", async () => {
    const before = conditions();
    for (const label of [
      "增长与需求",
      "通胀与政策",
      "信用与地产",
      "就业与收入",
      "景气与预期",
      "长期背景",
      "经济全景",
    ]) {
      await page
        .getByRole("navigation", { name: "宏观研究主题" })
        .getByRole("button", { name: label, exact: true })
        .click();
      await ready();
      assert.deepEqual(conditions(), before);
      await panel("annual:gdp").waitFor();
      await panel("cycle:loanStandards").waitFor();
    }
    await page.getByRole("button", { name: "指标与钉选", exact: true }).click();
    await dialog().getByLabel("搜索宏观指标", { exact: true }).fill("cycle:loanStandards");
    await dialog().getByRole("button", { name: "取消钉选", exact: true }).click();
    await waitParam("rPins", "annual:gdp");
    await dialog().getByRole("button", { name: "钉选到工作台", exact: true }).click();
    await waitParam("rPins", "annual:gdp,cycle:loanStandards");
    await closeDialog();
    assert.deepEqual(conditions(), before);
  });
  await step("calendar hover, keyboard and locked cross-frequency cursor", async () => {
    await page.getByLabel("固定联动参考日期", { exact: true }).fill("2025-02-15");
    await assertCursor("2025-02-15");
    for (const metric of ["annual:gdp", "cycle:inflation", "debt:debtService"])
      await assertReading(metric, "USA", "2025-02-15", true);
    await page.getByRole("button", { name: "读取最新", exact: true }).click();
    const chart = panel("cycle:inflation").locator(".research-chart-canvas");
    await chart.scrollIntoViewIfNeeded();
    await chart.locator("svg").waitFor();
    await chart.focus();
    await chart.press("Home");
    await assertCursor("2024-01-31");
    await chart.press("End");
    await assertCursor(latest(seriesFor("USA", "cycle:inflation"), maxDate, false).date);
    await chart.press("Escape");
    await assertCursor("");
    const box = await chart.boundingBox();
    assert(box);
    await page.mouse.move(box.x + box.width * 0.47, box.y + box.height * 0.4);
    await page.waitForFunction(() =>
      /^\d{4}-\d{2}-\d{2}$/u.test(
        document.querySelector(".research-workbench")?.dataset.cursor ?? "",
      ),
    );
    const date = await workbench().getAttribute("data-cursor");
    assert(date >= "2024-01-01" && date <= maxDate);
    await assertCursor(date);
    for (const metric of ["annual:gdp", "cycle:inflation", "debt:debtService"])
      await assertReading(metric, "USA", date, true);
    await page.mouse.move(5, 5);
    await assertCursor("");
  });
  await step("local layout, share URL and full reload", async () => {
    const before = conditions();
    await page.getByRole("button", { name: "保存布局", exact: true }).click();
    const saved = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("bcr:macro-research-layout")),
    );
    assert.equal(saved.version, 1);
    assert(saved.url.startsWith("/markets?"));
    await page
      .getByRole("navigation", { name: "宏观研究主题" })
      .getByRole("button", { name: "长期背景", exact: true })
      .click();
    await waitParam("rPreset", "history");
    await page.getByRole("button", { name: "恢复布局", exact: true }).click();
    await waitParam("rPreset", "overview");
    assert.deepEqual(conditions(), before);
    await page.getByRole("button", { name: "复制宏观工作台链接", exact: true }).click();
    await page.waitForFunction(() =>
      navigator.clipboard.readText().then((text) => text.includes("rPins=")),
    );
    const shared = new URL(await page.evaluate(() => navigator.clipboard.readText()));
    for (const key of conditionKeys) assert.equal(shared.searchParams.get(key), query().get(key));
    await page.reload({ waitUntil: "domcontentloaded" });
    await ready();
    assert.deepEqual(conditions(), before);
  });
  await step("one cutoff crops native Q/M/A tables and complete CSV exports", async () => {
    await navigate(
      routeUrl({
        countries: "USA",
        rPins: "annual:gdp,cycle:loanStandards",
        rFrom: "2024-02-15",
        rTo: "2025-08-15",
        rDate: "2025-07-20",
        rAsOf: "date",
      }),
    );
    assert.equal(await workbench().getAttribute("data-cutoff"), "2025-07-20");
    const metrics = await page
      .locator(".research-panel")
      .evaluateAll((nodes) => nodes.map((node) => node.dataset.metric));
    const rows = await exportCsv(
      page.getByRole("button", { name: "导出面板 CSV", exact: true }),
      "all-panels",
    );
    const records = validateCsv(rows, metrics, ["USA"], "2024-02-15", "2025-07-20", "USA");
    assert.deepEqual(
      [...new Set(records.filter((row) => row[1] === "annual:gdp").map((row) => row[3]))],
      ["2024"],
    );
    assert(
      records.filter((row) => row[1] === "cycle:inflation").every((row) => row[3] <= "2025-06"),
    );
    assert(
      records.filter((row) => row[1] === "debt:debtService").every((row) => row[3] <= "2025-Q2"),
    );
    await inspect("annual:gdp", "原始期次数据");
    const tableRows = await dialog()
      .getByRole("table", { name: "USA 统一指标数据表", exact: true })
      .locator("tbody tr")
      .allTextContents();
    const expected = within(seriesFor("USA", "annual:gdp"), "2024-02-15", "2025-07-20");
    assert.equal(tableRows.length, expected.length);
    assert(tableRows[0].includes("2024"));
    assert(
      tableRows.every((row, index) =>
        row.includes(format(expected.toReversed()[index].value, "usd")),
      ),
      "Native table values agree with annual JSON",
    );
    validateCsv(
      await exportCsv(
        dialog().getByRole("button", { name: "导出指标 CSV", exact: true }),
        "annual-gdp",
      ),
      ["annual:gdp"],
      ["USA"],
      "2024-02-15",
      "2025-07-20",
      "USA",
    );
    await closeDialog();
    await inspect("debt:debtService", "口径与来源");
    assert.equal(
      await dialog()
        .locator("dt")
        .filter({ hasText: /^来源更新$/u })
        .locator("xpath=following-sibling::dd[1]")
        .innerText(),
      "未披露",
    );
    assert(
      (await dialog().locator(".research-sources a").first().getAttribute("href")).startsWith(
        "https://",
      ),
    );
    await closeDialog();
    await page.getByLabel("统一观察方式", { exact: true }).selectOption("latest");
    await waitParam("rAsOf", "latest");
    assert.equal(await workbench().getAttribute("data-cutoff"), "2025-08-15");
    assert.equal(
      query().get("rDate"),
      "2025-07-20",
      "Latest retains an unused reference date without treating it as a cutoff",
    );
  });
  await step("country colors, focused local currency and global annual fallback", async () => {
    await navigate(routeUrl());
    const color = async () =>
      page
        .locator(".research-matrix tbody tr")
        .filter({ has: page.getByRole("button", { name: "日本", exact: true }) })
        .locator("i")
        .evaluate((node) => getComputedStyle(node).backgroundColor);
    const before = await color();
    await page.getByRole("button", { name: "选择研究经济体", exact: true }).click();
    const usa = dialog()
      .locator(".research-country-list button")
      .filter({ hasText: /\bUSA\b/u });
    await usa.click();
    await waitParam("countries", "JPN");
    await usa.click();
    await waitParam("countries", "JPN,USA");
    await dialog().getByRole("button", { name: "完成经济体选择", exact: true }).click();
    assert.equal(await color(), before);
    await navigate(
      routeUrl({ countries: "CHN,USA", rFocus: "USA", rPins: "debt:privateCreditStock" }),
    );
    assert.deepEqual(
      await panel("debt:privateCreditStock")
        .locator(".research-chart-reading > span")
        .allTextContents(),
      ["USA"],
    );
    await page.getByLabel("聚焦经济体", { exact: true }).selectOption("CHN");
    await waitParam("rFocus", "CHN");
    assert.deepEqual(
      await panel("debt:privateCreditStock")
        .locator(".research-chart-reading > span")
        .allTextContents(),
      ["CHN"],
    );
    assert((await panel("debt:privateCreditStock").innerText()).includes("人民币"));
    assert.equal(query().get("countries"), "CHN,USA");
    await navigate(routeUrl({ countries: "IND,USA", rFocus: "IND" }));
    await panel("annual:gdp").waitFor();
    assert.equal(await page.locator('.research-panel[data-metric^="cycle:"]').count(), 0);
    assert.equal(query().get("countries"), "IND,USA");
    await assertReading("annual:gdp", "IND", maxDate);
    await page.getByRole("button", { name: "选择研究经济体", exact: true }).click();
    for (const id of ["USA", "IND"])
      await dialog()
        .locator(".research-country-list button")
        .filter({ hasText: new RegExp(`\\b${id}\\b`, "u") })
        .click();
    await dialog().getByRole("button", { name: "完成经济体选择", exact: true }).click();
    await page
      .getByText("请选择至少一个经济体，开始比较增长、物价、就业和金融条件。", { exact: true })
      .waitFor();
    assert.equal(query().get("countries"), "");
    assert.equal(await page.locator(".research-panel").count(), 0);
  });
  await step("historical events update every panel and retain month/year precision", async () => {
    for (const event of [
      {
        id: "us-recession-1981",
        title: "美国 1981—1982 年衰退",
        from: "1980-01-01",
        to: "1988-12-31",
        end: "1984-12-31",
        note: "1981-07 — 1982-11（月精度）",
      },
      {
        id: "china-fx-reform-1994",
        title: "中国外汇管理体制改革",
        from: "1990-01-01",
        to: "1996-12-31",
        end: "1996-12-31",
        note: "1994（年精度）",
      },
    ]) {
      await navigate(
        routeUrl({
          countries: "CHN,USA",
          rFocus: "USA",
          rFrom: event.from,
          rTo: event.to,
          rPins: "annual:gdp",
        }),
      );
      await page
        .locator(".research-event-rail")
        .getByRole("button", { name: new RegExp(event.title, "u") })
        .click();
      await waitParam("rEvent", event.id);
      assert.equal(query().get("rAsOf"), "date");
      assert.equal(query().get("rTo"), event.end);
      const notes = await page
        .locator(".research-panel .research-chart-event-note")
        .allTextContents();
      assert.equal(notes.length, await page.locator(".research-panel").count());
      assert(notes.every((note) => note.includes(event.note)));
      assert.equal(await workbench().getAttribute("data-cutoff"), event.end);
    }
  });
  await step("320/390 light/dark, library/country/source/table internal scrolling", async () => {
    await navigate(routeUrl({ rPins: "annual:gdp" }));
    for (const width of [320, 390])
      for (const theme of ["light", "dark"]) {
        await page.setViewportSize({ width, height: 844 });
        await page.evaluate((theme) => {
          document.documentElement.dataset.theme = theme;
        }, theme);
        await assertViewport(page);
        await page.getByRole("button", { name: "指标与钉选", exact: true }).click();
        await assertViewport(page);
        await closeDialog();
        await page.getByRole("button", { name: "选择研究经济体", exact: true }).click();
        await assertViewport(page);
        await closeDialog();
        await inspect("cycle:inflation", "原始期次数据");
        await assertViewport(page);
        assert.equal(
          await dialog()
            .locator(".research-table-scroll")
            .first()
            .evaluate((node) => getComputedStyle(node).overflowX),
          "auto",
        );
        await dialog().getByRole("button", { name: "口径与来源", exact: true }).click();
        await assertViewport(page);
        await page.screenshot({ path: `${shots}/research-${host}-${width}-${theme}-sources.png` });
        await closeDialog();
      }
    await page.setViewportSize({ width: 1440, height: 1050 });
  });
  await step("classic cycle/debt round trip retains old and new research parameters", async () => {
    const url = new URL(routeUrl({ countries: "USA,IND", rFocus: "USA", rPins: "annual:gdp" }));
    for (const [key, value] of Object.entries({
      layer: "cycle",
      cycleMetric: "policyRate",
      cycleWindow: "10y",
      period: "2025-06",
      cycleFocus: "USA",
    }))
      url.searchParams.set(key, value);
    await page.evaluate((next) => {
      history.pushState(null, "", next);
      dispatchEvent(new PopStateEvent("popstate"));
    }, url.href);
    await page.locator('.cycle-atlas[data-period="2025-06"]').waitFor();
    const before = conditions(),
      nav = page.getByRole("navigation", { name: "宏观研究视图", exact: true });
    await nav.getByRole("button", { name: /债务/u }).click();
    await page.locator(".debt-atlas").waitFor();
    await page.getByLabel("债务趋势指标", { exact: true }).selectOption("creditGap");
    await page.waitForFunction(
      () => new URLSearchParams(location.search).get("debtMetric") === "creditGap",
    );
    await nav.getByRole("button", { name: /周期/u }).click();
    await page.locator('.cycle-atlas[data-period="2025-06"]').waitFor();
    assert.equal(query().get("cycleMetric"), "policyRate");
    assert.equal(query().get("cycleWindow"), "10y");
    assert.equal(query().get("period"), "2025-06");
    assert.deepEqual(conditions(), before);
    await navigate(routeUrl());
    assert.deepEqual(three(), [], "Classic 2D navigation also keeps Three.js unloaded");
  });
  await step("Three.js loads only after opening the CLI three-dimensional detail", async () => {
    await inspect("cycle:cli");
    assert.deepEqual(three(), []);
    await dialog().getByRole("button", { name: "展开三维周期轨迹", exact: true }).click();
    await dialog().locator(".research-space .cycle-space").waitFor();
    assert(three().length > 0, "Three-dimensional code was requested after the explicit action");
    await closeDialog();
  });
  assert.deepEqual(external, [], "Built-in research never requests external services");
  assert.deepEqual(errors, [], "No runtime or console errors");
  console.log(
    `[research:${host}] Passed: native data, shared state/cursor, complete CSV, layout, events, global countries, classic links, lazy 3D and responsive drawers.`,
  );
} catch (error) {
  await page.screenshot({ path: `${shots}/research-${host}-failure.png`, fullPage: true });
  console.error(error);
  if (errors.length) console.error("Browser errors:", errors);
  process.exitCode = 1;
} finally {
  await browser.close();
}
