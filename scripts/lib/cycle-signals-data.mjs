import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "./browser.mjs";

// Independent expectations from actual resources; never import production derivation logic.
const root = process.env.BCR_VERIFY_REPO_ROOT ?? repoRoot;
const resourceDir = path.join(root, "packages/market-data/src/cycle");
const files = (await readdir(resourceDir)).filter((name) => name.endsWith("-snapshot.json"));
const resources = await Promise.all(
  files.map(async (name) => JSON.parse(await readFile(path.join(resourceDir, name), "utf8"))),
);
const names = { CHN: "中国", USA: "美国", JPN: "日本", DEU: "德国", GBR: "英国" };
const allCountries = Object.keys(names);
const number = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
const suffix = {
  percent: "%",
  percentagePoints: " 个百分点",
  thousandPersons: " 千人",
  persons: " 人",
  thousandUnits: " 千套",
  hours: " 小时",
  ratio: " 倍",
  billionsUsd: " 十亿美元",
};
const format = (value, unit) =>
  value == null ? "—" : `${number.format(value)}${suffix[unit] ?? ""}`;
const month = (period) =>
  /^\d{4}-Q[1-4]$/u.test(period)
    ? `${period.slice(0, 4)}-${String(Number(period.at(-1)) * 3).padStart(2, "0")}`
    : period.slice(0, 7);
const monthIndex = (period) => Number(period.slice(0, 4)) * 12 + Number(period.slice(5, 7)) - 1;
const shift = (period, amount) => {
  const n = monthIndex(period) + amount;
  return `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, "0")}`;
};
const latestStamp = (series) =>
  series.observations
    .filter((point) => point.value != null)
    .map((point) => (point.period.length === 10 ? point.period : `${month(point.period)}-31`))
    .sort()
    .at(-1) ?? "";
const raw = new Map();
for (const snapshot of resources)
  for (const series of snapshot.series) {
    const key = `${series.country}:${series.indicator}`,
      previous = raw.get(key);
    if (
      !previous ||
      latestStamp(series) > latestStamp(previous) ||
      (latestStamp(series) === latestStamp(previous) &&
        Date.parse(series.fetchedAt) > Date.parse(previous.fetchedAt))
    )
      raw.set(key, series);
  }
const exact = (series, period) =>
  series?.observations.find((point) => point.period === period)?.value ?? null;
const indexGrowth = new Set([
  "industrialProduction",
  "retailVolume",
  "realConsumption",
  "payrolls",
  "realIncome",
]);
const display = (series, point) =>
  indexGrowth.has(series.indicator) && series.frequency === "M" && series.unit !== "percent"
    ? point.value == null ||
      exact(series, shift(point.period, -12)) == null ||
      exact(series, shift(point.period, -12)) === 0
      ? null
      : (point.value / exact(series, shift(point.period, -12)) - 1) * 100
    : point.value;
const displayUnit = (series) => (indexGrowth.has(series.indicator) ? "percent" : series.unit);
const get = (country, metric) => raw.get(`${country}:${metric}`);
function derived(country, metric) {
  const source = get(
    country,
    metric === "coreInflation3m"
      ? "corePriceIndex"
      : metric === "payrollChange"
        ? "payrolls"
        : metric === "unemploymentGap"
          ? "unemployment"
          : "policyRate",
  );
  if (!source || (metric === "realPolicyRate" && !get(country, "inflation"))) return undefined;
  const calculate = (period) => {
    if (metric === "payrollChange") {
      const a = exact(source, period),
        b = exact(source, shift(period, -1));
      return a == null || b == null ? null : a - b;
    }
    if (metric === "realPolicyRate") {
      const a = exact(source, period),
        b = exact(get(country, "inflation"), period);
      return a == null || b == null ? null : a - b;
    }
    const values = Array.from({ length: metric === "coreInflation3m" ? 4 : 14 }, (_, i) =>
      exact(source, shift(period, i - (metric === "coreInflation3m" ? 3 : 13))),
    );
    if (values.some((value) => value == null || (metric === "coreInflation3m" && value <= 0)))
      return null;
    if (metric === "coreInflation3m") return ((values[3] / values[0]) ** 4 - 1) * 100;
    const means = Array.from(
      { length: 12 },
      (_, i) => (values[i] + values[i + 1] + values[i + 2]) / 3,
    );
    return means.at(-1) - Math.min(...means);
  };
  return {
    ...source,
    indicator: metric,
    unit:
      metric === "payrollChange"
        ? "thousandPersons"
        : metric === "unemploymentGap"
          ? "percentagePoints"
          : "percent",
    observations: source.observations.map((point) => ({
      period: point.period,
      value: calculate(point.period),
    })),
  };
}
const derivedCache = new Map();
const seriesFor = (country, metric) => {
  const original = get(country, metric);
  if (original) return original;
  if (!isDerived(metric) || (country !== "USA" && metric !== "realPolicyRate")) return undefined;
  const key = `${country}:${metric}`;
  if (!derivedCache.has(key)) derivedCache.set(key, derived(country, metric));
  return derivedCache.get(key);
};
const latest = (series, end) =>
  series?.observations.filter((point) => point.value != null && month(point.period) <= end).at(-1);
const latestEnd = (countries, metric) =>
  countries
    .map((country) => seriesFor(country, metric)?.observations.at(-1)?.period)
    .filter(Boolean)
    .map(month)
    .sort()
    .at(-1);
const isDerived = (metric) =>
  ["realPolicyRate", "coreInflation3m", "payrollChange", "unemploymentGap"].includes(metric);
const header = [
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
];
function csvRows(text) {
  const rows = [],
    row = [];
  let field = "",
    quoted = false;
  for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && c === ",") {
      row.push(field);
      field = "";
    } else if (!quoted && (c === "\r" || c === "\n")) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some(Boolean)) rows.push([...row]);
      row.length = 0;
      field = "";
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  assert(!quoted, "CSV quotes close correctly");
  return rows;
}
function assertNumeric(cell, expected, message) {
  if (expected == null) assert.equal(cell, "", `${message}: missing stays empty`);
  else {
    assert.notEqual(cell, "", message);
    assert(Math.abs(Number(cell) - expected) < 1e-9, `${message}: ${cell} != ${expected}`);
  }
}

export function validateExport(rows, metric, countries, end, window) {
  const start = window === "all" ? "2000-01" : shift(end, window === "10y" ? -119 : -59);
  const expectedCount = countries.reduce(
    (n, country) =>
      n +
      (seriesFor(country, metric)?.observations.filter(
        (point) => month(point.period) >= start && month(point.period) <= end,
      ).length ?? 0),
    0,
  );
  assert.equal(rows.length, expectedCount, `${metric}: CSV contains native periods only`);
  for (const row of rows) {
    assert.equal(row.length, 17);
    const series = seriesFor(row[0], metric),
      original = get(row[0], metric),
      point = series.observations.find((point) => point.period === row[2]);
    assert(countries.includes(row[0]) && row[1] === metric && point);
    assert.equal(row[4], displayUnit(series));
    assert.equal(row[6], series.unit);
    assert.equal(row[7], series.frequency);
    assert.equal(row[8], series.seasonalAdjustment);
    assertNumeric(row[3], display(series, point), `${metric} ${row[0]} ${point.period} display`);
    assertNumeric(row[5], point.value, `${metric} ${row[0]} ${point.period} raw`);
    assert(
      row[10] &&
        row[11] &&
        row[12].startsWith("https://") &&
        row[13] &&
        row[15].startsWith("https://") &&
        row[16],
      "Full source, licence, note and fetch date survive CSV export",
    );
    if (isDerived(metric)) {
      assert(
        row[9].startsWith("derived") &&
          row[10].includes("计算值") &&
          row[11].includes(`derived-${metric}`),
      );
      assert.equal(row[14], "");
      assert(
        row[16].includes("计算值") &&
          row[16].includes("输入与来源") &&
          row[16].includes(series.source.url),
      );
    } else {
      assert.equal(row[9], point.status ?? "");
      assert.equal(row[11], original.source.seriesCode);
      assert.equal(row[12], original.source.url);
      assert.equal(row[13], original.fetchedAt);
      assert.equal(row[14], original.sourceUpdatedAt ?? "");
      assert.equal(row[15], original.source.licenseUrl ?? "");
      assert.equal(row[16], original.note ?? "");
    }
  }
}

export function expectedHealth(country, metric, start, end) {
  const series = seriesFor(country, metric);
  if (!series) return null;
  const within = series.observations.filter(
    (point) => month(point.period) >= start && month(point.period) <= end,
  );
  const valid = within.filter((point) => display(series, point) != null);
  const recent = series.observations
    .filter((point) => display(series, point) != null && month(point.period) <= end)
    .at(-1);
  const age = recent ? monthIndex(end) - monthIndex(month(recent.period)) : null;
  let expected = null;
  if (series.frequency === "M") expected = monthIndex(end) - monthIndex(start) + 1;
  if (series.frequency === "Q") {
    expected = 0;
    for (let n = monthIndex(start); n <= monthIndex(end); n++) if (n % 3 === 2) expected++;
  }
  return {
    latest: recent?.period ?? "未收录",
    age: age === null ? "—" : `${age} 个月`,
    coverage:
      expected === null
        ? `${valid.length}/${within.length} 条有效`
        : `${valid.length}/${expected} 期`,
    sourceUpdatedAt: isDerived(metric)
      ? "未披露"
      : (series.sourceUpdatedAt?.slice(0, 10) ?? "未披露"),
  };
}

export {
  allCountries,
  csvRows,
  display,
  displayUnit,
  exact,
  files,
  format,
  get,
  header,
  isDerived,
  latest,
  latestEnd,
  monthIndex,
  names,
  seriesFor,
  shift,
};

export async function assertCycleViewport(page) {
  const offenders = await page.evaluate(() => {
    const result = [];
    if (document.documentElement.scrollWidth > innerWidth + 1) result.push("document");
    for (const node of document.querySelectorAll(
      ".macro-main,.macro-chart-panel,.cycle-signal-navigator,.cycle-signal-choices,.cycle-trend-cutoff,.cycle-readouts,.cycle-health-area,[role=dialog]",
    ))
      if (node.getClientRects().length && node.scrollWidth > node.clientWidth + 1)
        result.push(node.className || node.tagName);
    for (const node of document.querySelectorAll(
      ".cycle-atlas button,.cycle-atlas select,.cycle-atlas input,[role=dialog] button,[role=dialog] select,[role=dialog] input",
    )) {
      const rect = node.getBoundingClientRect();
      if (rect.width && rect.height && (rect.left < -1 || rect.right > innerWidth + 1))
        result.push(
          `${node.tagName}:${node.getAttribute("aria-label") || node.textContent?.trim().slice(0, 30)}`,
        );
    }
    return result;
  });
  assert.deepEqual(
    offenders,
    [],
    "Controls and content reflow within the viewport; native tables may scroll internally",
  );
}

/** Use real browser history after initial load; keep explicit reload tests in the caller. */
export async function navigateCyclePage(page, url) {
  if (
    new URL(page.url()).origin === new URL(url).origin &&
    (await page.locator(".cycle-atlas").count())
  ) {
    await page.evaluate((next) => {
      history.pushState(null, "", next);
      dispatchEvent(new PopStateEvent("popstate"));
    }, url);
  } else await page.goto(url, { waitUntil: "networkidle" });
}
