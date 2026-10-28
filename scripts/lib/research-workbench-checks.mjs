import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "./browser.mjs";

// Independent oracle from checked-in resources; do not import production adapters or queries.
const root = process.env.BCR_VERIFY_REPO_ROOT ?? repoRoot;
const readJson = async (file) =>
  JSON.parse(await readFile(path.join(root, "packages/market-data/src", file), "utf8"));
const number = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2, notation: "compact" });
const suffix = {
  index: "",
  percent: "%",
  percentagePoints: " 个百分点",
  percentGdp: "% GDP",
  percentIncome: "% 收入",
  percentRevenue: "% 财政收入",
  persons: " 人",
  thousandPersons: " 千人",
  billionsUsd: " 十亿美元",
  thousandUnits: " 千套",
  hours: " 小时",
  ratio: " 倍",
};
const currencyNames = { CNY: "人民币", USD: "美元", JPY: "日元", EUR: "欧元", GBP: "英镑" };
export function format(value, unit, currency = null) {
  if (value == null) return "—";
  if (unit === "usd") return `${compact.format(value)} 美元`;
  if (["billionLocal", "trillionLocal"].includes(unit))
    return `${number.format(value)} ${unit === "billionLocal" ? "十亿" : "万亿"}${currencyNames[currency] ?? currency ?? "（币种未提供）"}`;
  return `${number.format(value)}${suffix[unit] ?? ` ${unit}`}`;
}
export function periodEnd(period, frequency) {
  if (frequency === "A") return `${period}-12-31`;
  if (frequency === "W" || frequency === "D") return period;
  const month = frequency === "Q" ? Number(period.at(-1)) * 3 : Number(period.slice(5, 7));
  return new Date(Date.UTC(Number(period.slice(0, 4)), month, 0)).toISOString().slice(0, 10);
}
const monthIndex = (period) => Number(period.slice(0, 4)) * 12 + Number(period.slice(5, 7)) - 1;
const shift = (period, amount) => {
  const index = monthIndex(period) + amount;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
};
const growthIds = new Set([
  "industrialProduction",
  "retailVolume",
  "realConsumption",
  "payrolls",
  "realIncome",
]);
const raw = new Map();
for (const domain of ["cycle", "debt"]) {
  const files = (await readdir(path.join(root, `packages/market-data/src/${domain}`))).filter(
    (file) => file.endsWith("-snapshot.json"),
  );
  for (const file of files)
    for (const series of (await readJson(`${domain}/${file}`)).series) {
      const key = `${domain}:${series.country}:${series.indicator}`,
        previous = raw.get(key);
      const stamp = (item) =>
        item.observations
          .filter((point) => point.value != null)
          .map((point) => periodEnd(point.period, item.frequency))
          .sort()
          .at(-1) ?? "";
      if (
        !previous ||
        stamp(series) > stamp(previous) ||
        (stamp(series) === stamp(previous) &&
          Date.parse(series.fetchedAt) > Date.parse(previous.fetchedAt))
      )
        raw.set(key, { ...series, domain });
    }
}
const annual = await readJson("macro/worldbank-snapshot.json");
const annualCodes = {
  gdp: "NY.GDP.MKTP.CD",
  growth: "NY.GDP.MKTP.KD.ZG",
  inflation: "FP.CPI.TOTL.ZG",
  gdpPerCapita: "NY.GDP.PCAP.CD",
  unemployment: "SL.UEM.TOTL.ZS",
  trade: "NE.TRD.GNFS.ZS",
};
for (const [country, indicator, first, values] of annual.series)
  raw.set(`annual:${country}:${indicator}`, {
    domain: "annual",
    country,
    indicator,
    frequency: "A",
    unit: ["gdp", "gdpPerCapita"].includes(indicator) ? "usd" : "percent",
    currency: ["gdp", "gdpPerCapita"].includes(indicator) ? "USD" : null,
    source: {
      name: annual.source,
      url: annual.sourceUrl,
      licenseUrl: annual.license,
      seriesCode: annualCodes[indicator],
    },
    fetchedAt: annual.fetchedAt,
    sourceUpdatedAt: annual.sourceUpdatedAt,
    seasonalAdjustment: "notApplicable",
    observations: Array.from({ length: annual.endYear - annual.startYear + 1 }, (_, i) => ({
      period: String(annual.startYear + i),
      value: values[annual.startYear + i - first] ?? null,
    })),
  });
for (const series of [...raw.values()].filter(
  (item) => item.domain === "debt" && item.indicator === "privateCreditStock",
)) {
  const lookup = new Map(series.observations.map((point) => [point.period, point.value]));
  raw.set(`debt:${series.country}:creditGrowth`, {
    ...series,
    indicator: "creditGrowth",
    unit: "percent",
    currency: null,
    computed: true,
    source: {
      ...series.source,
      name: `${series.source.name} · 本币余额同比计算`,
      seriesCode: `${series.source.seriesCode} / derived-yoy-4q`,
    },
    observations: series.observations.map((point) => {
      const previous = lookup.get(
        `${Number(point.period.slice(0, 4)) - 1}${point.period.slice(4)}`,
      );
      return {
        period: point.period,
        value:
          point.value == null || previous == null || previous <= 0
            ? null
            : (point.value / previous - 1) * 100,
        status: point.status ? `derived:${point.status}` : "derived",
      };
    }),
  });
}
const seriesCache = new Map();
export function seriesFor(country, metric) {
  const key = `${country}:${metric}`;
  if (seriesCache.has(key)) return seriesCache.get(key);
  const [domain, indicator] = metric.split(":"),
    source = raw.get(`${domain}:${country}:${indicator}`);
  if (!source) return null;
  const converted =
    domain === "cycle" &&
    growthIds.has(indicator) &&
    source.unit !== "percent" &&
    source.frequency === "M";
  const unit = domain === "cycle" && growthIds.has(indicator) ? "percent" : source.unit;
  const lookup = new Map(source.observations.map((point) => [point.period, point.value]));
  const result = {
    ...source,
    metric,
    rawUnit: source.unit,
    unit,
    observations: source.observations.map((point) => {
      const previous = converted ? lookup.get(shift(point.period, -12)) : null;
      return {
        ...point,
        date: periodEnd(point.period, source.frequency),
        rawValue: point.value,
        value: converted
          ? point.value == null || previous == null || previous === 0
            ? null
            : (point.value / previous - 1) * 100
          : point.value,
      };
    }),
    computed: converted || source.computed || false,
  };
  seriesCache.set(key, result);
  return result;
}
const bounds = [...raw.values()]
  .flatMap((series) =>
    series.observations.map((point) => periodEnd(point.period, series.frequency)),
  )
  .sort((a, b) => a.localeCompare(b));
export const minDate = bounds[0],
  maxDate = bounds.at(-1);
export const latest = (series, cutoff, valid = true) =>
  series?.observations
    .filter((point) => point.date <= cutoff && (!valid || point.value !== null))
    .at(-1) ?? null;
export const within = (series, from, to) =>
  series?.observations.filter((point) => point.date >= from && point.date <= to) ?? [];
export const header = [
  "series_id",
  "metric_id",
  "country",
  "period",
  "date",
  "display_value",
  "display_unit",
  "raw_value",
  "raw_unit",
  "frequency",
  "seasonal_adjustment",
  "currency",
  "valuation",
  "status",
  "computed",
  "source",
  "series_code",
  "source_url",
  "source_updated_at",
  "fetched_at",
  "license_url",
  "note",
];
export function csvRows(text) {
  const rows = [],
    row = [];
  let field = "",
    quoted = false;
  for (let index = text.charCodeAt(0) === 0xfeff ? 1 : 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index++;
      } else quoted = !quoted;
    } else if (!quoted && char === ",") {
      row.push(field);
      field = "";
    } else if (!quoted && (char === "\r" || char === "\n")) {
      if (char === "\r" && text[index + 1] === "\n") index++;
      row.push(field);
      rows.push([...row]);
      row.length = 0;
      field = "";
    } else field += char;
  }
  if (row.length || field) {
    row.push(field);
    rows.push(row);
  }
  assert(!quoted, "CSV quotes must close");
  return rows;
}
function assertNumeric(actual, expected, label) {
  if (expected === null) assert.equal(actual, "", `${label}: null stays empty`);
  else {
    assert.notEqual(actual, "", label);
    assert(Math.abs(Number(actual) - expected) < 1e-9, `${label}: ${actual} != ${expected}`);
  }
}
export function validateCsv(rows, metrics, countries, from, cutoff, focus) {
  assert.deepEqual(rows[0], header);
  const records = rows.slice(1),
    seen = new Set();
  let count = 0;
  for (const metric of metrics) {
    let sources = countries.map((country) => seriesFor(country, metric)).filter(Boolean);
    if (new Set(sources.map((source) => source.currency).filter(Boolean)).size > 1)
      sources = sources.filter((source) => source.country === focus);
    for (const source of sources) count += within(source, from, cutoff).length;
  }
  assert.equal(
    records.length,
    count,
    "CSV contains every visible native observation, including nulls",
  );
  for (const row of records) {
    assert.equal(row.length, header.length);
    const source = seriesFor(row[2], row[1]),
      point = source?.observations.find((item) => item.period === row[3]);
    assert(
      metrics.includes(row[1]) && countries.includes(row[2]) && point,
      `Unexpected native series ${row.slice(1, 5)}`,
    );
    const key = `${row[1]}:${row[2]}:${row[3]}`;
    assert(!seen.has(key), `No duplicate native observations: ${key}`);
    seen.add(key);
    assert(row[0] && row[4] >= from && row[4] <= cutoff);
    assert.equal(row[4], point.date);
    assertNumeric(row[5], point.value, key);
    assertNumeric(row[7], point.rawValue, `${key} raw`);
    assert.equal(row[6], source.unit);
    assert.equal(row[8], source.rawUnit);
    assert.equal(row[9], source.frequency);
    assert.equal(row[10], source.seasonalAdjustment);
    assert.equal(row[11], source.currency ?? "");
    assert.equal(row[13], point.status ?? "");
    assert.equal(row[14], String(source.computed));
    assert.equal(row[16], source.source.seriesCode);
    assert.equal(row[17], source.source.url);
    assert.equal(
      row[18],
      source.sourceUpdatedAt ?? "",
      "Unknown source updates remain blank, never replaced by fetch date",
    );
    assert.equal(row[19], source.fetchedAt);
    assert.equal(row[20], source.source.licenseUrl ?? "");
    assert(row[15] && row[21], "Source name and economic note survive export");
  }
  return records;
}
export async function assertViewport(page) {
  const errors = await page.evaluate(() => {
    const issues = [],
      visible = (node) =>
        node.getClientRects().length && getComputedStyle(node).visibility !== "hidden";
    if (document.documentElement.scrollWidth > innerWidth + 1)
      issues.push("document horizontal overflow");
    const dialog = document.querySelector("dialog[open]");
    const roots = dialog
      ? [dialog]
      : [
          ...document.querySelectorAll(
            ".research-workbench,.research-controls,.research-panel-grid",
          ),
        ];
    for (const node of roots)
      if (visible(node) && node.scrollWidth > node.clientWidth + 1)
        issues.push(`${node.className}: ${node.scrollWidth}/${node.clientWidth}`);
    if (dialog) {
      const rect = dialog.getBoundingClientRect();
      if (
        rect.left < -1 ||
        rect.right > innerWidth + 1 ||
        rect.top < -1 ||
        rect.bottom > innerHeight + 1
      )
        issues.push("dialog exceeds viewport");
      const body = dialog.querySelector(".ui-dialog-body");
      if (!body || !["auto", "scroll"].includes(getComputedStyle(body).overflowY))
        issues.push("dialog has no internal vertical scroll");
    }
    for (const node of (dialog ?? document.querySelector(".research-controls")).querySelectorAll(
      "button,input,select",
    )) {
      if (
        !visible(node) ||
        node.closest(".research-matrix-scroll,.research-event-rail,.research-table-scroll")
      )
        continue;
      const rect = node.getBoundingClientRect();
      if (rect.left < -1 || rect.right > innerWidth + 1)
        issues.push(
          `${node.tagName}: ${node.getAttribute("aria-label") ?? node.textContent.trim().slice(0, 30)}`,
        );
    }
    return issues;
  });
  assert.deepEqual(errors, [], "Viewport contains controls; tables and drawers scroll internally");
}

export async function assertPanelReading(page, metric, country, cutoff, cursor = false) {
  const panel = (id) => page.locator(`.research-panel[data-metric="${id}"]`);
  const source = seriesFor(country, metric),
    point = latest(source, cutoff, !cursor);
  assert(source, `Independent JSON source exists for ${metric}/${country}`);
  assert.equal(
    await panel(metric).locator(".research-panel-reading > strong").innerText(),
    format(point?.value, source.unit, source.currency),
    `${country}/${metric} native value`,
  );
  if (point)
    assert(
      (await panel(metric).locator(".research-panel-reading small").innerText()).includes(
        point.period,
      ),
      `${metric}: actual native reference period`,
    );
}
export async function assertSharedCursor(page, date) {
  await page.waitForFunction(
    (date) => document.querySelector(".research-workbench")?.getAttribute("data-cursor") === date,
    date,
  );
  assert.deepEqual(
    await page
      .locator(".research-panel .research-chart-canvas")
      .evaluateAll((nodes) => [...new Set(nodes.map((node) => node.dataset.cursorDate))]),
    [date],
    "Every panel shares one calendar date",
  );
}
