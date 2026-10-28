import type { CycleIndicatorId, CycleObservation, CycleSeries, CycleSnapshot } from "./model";

export const OECD_CYCLE_COUNTRIES = ["CHN", "USA", "JPN", "DEU", "GBR"] as const;
const countries = new Set<string>(OECD_CYCLE_COUNTRIES);
const base = "https://sdmx.oecd.org/public/rest/data/OECD.SDD.STES,";
export const OECD_CLI_URL = `${base}DSD_STES@DF_CLI,4.1/${OECD_CYCLE_COUNTRIES.join("+")}.M.LI...AA...H?startPeriod=2000-01&format=csvfile`;
export const OECD_KEI_URL = `${base}DSD_KEI@DF_KEI,4.0/${OECD_CYCLE_COUNTRIES.join("+")}.M+Q.PRVM+TOVM+CP+UNEMP+B1GQ_Q....?startPeriod=2000-01&format=csvfile`;
export const OECD_CORE_URL = `https://sdmx.oecd.org/public/rest/data/OECD.SDD.TPS,DSD_PRICES@DF_PRICES_ALL,1.0/${OECD_CYCLE_COUNTRIES.join("+")}.M.N.CPI.PA._TXCP01_NRG.N.GY?startPeriod=2000-01&format=csvfile`;
export const OECD_JAPAN_PRICES_URL =
  "https://sdmx.oecd.org/public/rest/data/OECD.SDD.TPS,DSD_PRICES_COICOP2018@DF_PRICES_C2018_ALL,1.0/JPN.M.N.CPI.PA._T+_TXCP01_NRG.N.GY?startPeriod=2000-01&format=csvfile";
const licenseUrl = "https://www.oecd.org/en/about/terms-conditions.html";
type CsvRow = Record<string, string>;

/** RFC 4180 fields, including embedded commas, escaped quotes and CRLF records. */
export function parseOecdCsv(
  text: string,
  additionalDimensions: string[] = ["ACTIVITY"],
): CsvRow[] {
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (!quoted && (char === "," || char === "\n")) {
      row.push(field.replace(/\r$/u, ""));
      field = "";
      if (char === "\n") {
        if (row.some(Boolean)) rows.push(row);
        row = [];
      }
    } else field += char;
  }
  if (quoted) throw new Error("OECD CSV 引号未闭合");
  if (field || row.length) {
    row.push(field.replace(/\r$/u, ""));
    rows.push(row);
  }
  const header = rows.shift()?.map((column) => column.replace(/^\uFEFF/u, ""));
  const required = [
    "DATAFLOW",
    "REF_AREA",
    "FREQ",
    "MEASURE",
    "UNIT_MEASURE",
    "ADJUSTMENT",
    "TRANSFORMATION",
    "TIME_PERIOD",
    "OBS_VALUE",
    "OBS_STATUS",
    "UNIT_MULT",
    ...additionalDimensions,
  ];
  if (
    !header ||
    new Set(header).size !== header.length ||
    required.some((column) => !header.includes(column))
  )
    throw new Error("OECD CSV 缺少数据维度");
  return rows.map((values) => {
    if (values.length !== header.length) throw new Error("OECD CSV 列数不一致");
    return Object.fromEntries(header.map((column, index) => [column, values[index] ?? ""]));
  });
}

function validTimestamp(value: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new Error("OECD 抓取时间无效");
}
function observation(
  row: CsvRow,
  frequency: "M" | "Q",
  fetchedAt: string,
): CycleObservation | undefined {
  const period = row["TIME_PERIOD"] ?? "",
    status = row["OBS_STATUS"] ?? "";
  const pattern = frequency === "M" ? /^\d{4}-(0[1-9]|1[0-2])$/u : /^\d{4}-Q[1-4]$/u;
  if (!pattern.test(period)) throw new Error("OECD 观测期与频率不一致");
  const now = new Date(fetchedAt),
    current =
      frequency === "M"
        ? fetchedAt.slice(0, 7)
        : `${now.getUTCFullYear()}-Q${Math.floor(now.getUTCMonth() / 3) + 1}`;
  if (
    period < (frequency === "M" ? "2000-01" : "2000-Q1") ||
    period > current ||
    status.split(",").includes("F")
  )
    return undefined;
  const raw = row["OBS_VALUE"] ?? "";
  const value = raw === "" || raw === "NA" || raw === "NaN" ? null : Number(raw);
  if (value !== null && (!Number.isFinite(value) || raw.trim() === ""))
    throw new Error("OECD 观测值无效");
  // CPI annual-percentage observations omit UNIT_MULT in the official prices flows.
  if (row["UNIT_MULT"] !== "0" && !(row["UNIT_MEASURE"] === "PA" && row["UNIT_MULT"] === ""))
    throw new Error("OECD 单位倍数发生变化");
  return status ? { period, value, status } : { period, value };
}
function addPoint(series: CycleSeries, point: CycleObservation): void {
  const previous = series.observations.find((item) => item.period === point.period);
  if (previous && (previous.value !== point.value || previous.status !== point.status))
    throw new Error("OECD 同期观测冲突");
  if (!previous) series.observations.push(point);
}
function makeSeries(
  country: string,
  indicator: CycleIndicatorId,
  frequency: "M" | "Q",
  unit: CycleSeries["unit"],
  seasonalAdjustment: CycleSeries["seasonalAdjustment"],
  url: string,
  code: string,
  fetchedAt: string,
  note: string,
): CycleSeries {
  return {
    country,
    indicator,
    frequency,
    unit,
    seasonalAdjustment,
    source: { name: "OECD Data Explorer", url, seriesCode: code, licenseUrl },
    fetchedAt,
    sourceUpdatedAt: null,
    note,
    observations: [],
  };
}

export function parseOecdCliCsv(text: string, fetchedAt: string): CycleSeries[] {
  validTimestamp(fetchedAt);
  const grouped = new Map<string, CycleSeries>();
  for (const row of parseOecdCsv(text)) {
    const country = row["REF_AREA"] ?? "";
    if (
      !countries.has(country) ||
      row["DATAFLOW"] !== "OECD.SDD.STES:DSD_STES@DF_CLI(4.1)" ||
      row["FREQ"] !== "M" ||
      row["MEASURE"] !== "LI" ||
      row["UNIT_MEASURE"] !== "IX" ||
      row["ACTIVITY"] !== "_Z" ||
      row["ADJUSTMENT"] !== "AA" ||
      row["TRANSFORMATION"] !== "IX" ||
      row["TIME_HORIZ"] !== "_Z" ||
      row["METHODOLOGY"] !== "H"
    )
      throw new Error("OECD CLI 数据维度或频率不匹配");
    const point = observation(row, "M", fetchedAt);
    if (!point) continue;
    const series =
      grouped.get(country) ??
      makeSeries(
        country,
        "cli",
        "M",
        "index",
        "SA",
        OECD_CLI_URL,
        `OECD.SDD.STES:DSD_STES@DF_CLI(4.1)/${country}.M.LI.IX._Z.AA.IX._Z.H`,
        fetchedAt,
        "OECD 振幅调整综合先行指标，100 为长期趋势基准。月度、基于经季节调整的组成序列；会随新数据修订。CSV 未提供原始发布日期，来源更新时间留空。CLI 低于 100 不等同于经济衰退。建议关注方向与转折。",
      );
    addPoint(series, point);
    grouped.set(country, series);
  }
  return [...grouped.values()].map((series) => ({
    ...series,
    observations: series.observations.sort((a, b) => a.period.localeCompare(b.period)),
  }));
}

interface Selection {
  indicator: CycleIndicatorId;
  dimensions: string[];
  frequency: "M" | "Q";
  unit: CycleSeries["unit"];
  adjustment: CycleSeries["seasonalAdjustment"];
  note: string;
}
const selections: Selection[] = [
  {
    indicator: "industrialProduction",
    dimensions: ["M", "PRVM", "IX", "BTE", "Y", "_Z"],
    frequency: "M",
    unit: "index",
    adjustment: "SA",
    note: "工业生产量（不含建筑），指数基期 2015=100；经季节和日历调整。指数点位不能直接用于比较各国生产规模。",
  },
  {
    indicator: "retailVolume",
    dimensions: ["M", "TOVM", "IX", "G47", "Y", "_Z"],
    frequency: "M",
    unit: "index",
    adjustment: "SA",
    note: "零售贸易实际量指数，基期 2015=100；经季节和日历调整，不是名义零售额。各国覆盖和修订状态不同；P 为暂定值。",
  },
  {
    indicator: "unemployment",
    dimensions: ["M", "UNEMP", "PT_LF", "_T", "Y", "_Z"],
    frequency: "M",
    unit: "percent",
    adjustment: "SA",
    note: "月度失业率，占劳动力百分比，经季节和日历调整；不等同于年度 ILO 模型估计。",
  },
  {
    indicator: "inflation",
    dimensions: ["M", "CP", "GR", "_Z", "_Z", "GY"],
    frequency: "M",
    unit: "percent",
    adjustment: "NSA",
    note: "月度消费者价格同比变化率（GY），未经季节调整，不是环比。日本该 KEI 序列截止 2021-06，应视为历史覆盖，不用于当前判断。",
  },
  {
    indicator: "gdpGrowth",
    dimensions: ["Q", "B1GQ_Q", "GR", "_T", "Y", "GY"],
    frequency: "Q",
    unit: "percent",
    adjustment: "SA",
    note: "实际 GDP 季度同比增长率（GY）；经季节和日历调整。不是季度环比，也不是美国新闻常用的环比折年率。",
  },
];
const dimensionKeys = [
  "FREQ",
  "MEASURE",
  "UNIT_MEASURE",
  "ACTIVITY",
  "ADJUSTMENT",
  "TRANSFORMATION",
];

export function parseOecdKeiCsv(text: string, fetchedAt: string): CycleSeries[] {
  validTimestamp(fetchedAt);
  const grouped = new Map<string, CycleSeries>();
  for (const row of parseOecdCsv(text)) {
    const country = row["REF_AREA"] ?? "";
    if (
      !countries.has(country) ||
      row["DATAFLOW"] !== "OECD.SDD.STES:DSD_KEI@DF_KEI(4.0)" ||
      !["M", "Q"].includes(row["FREQ"] ?? "")
    )
      throw new Error("OECD KEI 数据维度或频率不匹配");
    const spec = selections.find((item) =>
      item.dimensions.every((value, index) => row[dimensionKeys[index] ?? ""] === value),
    );
    if (!spec) continue; // The batched official flow includes other activities, transformations and frequencies.
    const point = observation(row, spec.frequency, fetchedAt);
    if (!point) continue;
    const key = `${country}:${spec.indicator}`;
    const series =
      grouped.get(key) ??
      makeSeries(
        country,
        spec.indicator,
        spec.frequency,
        spec.unit,
        spec.adjustment,
        OECD_KEI_URL,
        `OECD.SDD.STES:DSD_KEI@DF_KEI(4.0)/${country}.${spec.dimensions.join(".")}`,
        fetchedAt,
        `${spec.note}${spec.indicator === "inflation" && country === "JPN" ? " 日本该 KEI 序列截止 2021-06，属于过期历史序列，不用于当前判断。" : ""} CSV 未提供该序列的原始发布日期，来源更新时间留空。`,
      );
    addPoint(series, point);
    grouped.set(key, series);
  }
  return [...grouped.values()].map((series) => ({
    ...series,
    observations: series.observations.sort((a, b) => a.period.localeCompare(b.period)),
  }));
}

/** Core here excludes all food and energy, not each country's national headline core definition. */
export function parseOecdCoreCsv(text: string, fetchedAt: string): CycleSeries[] {
  validTimestamp(fetchedAt);
  const grouped = new Map<string, CycleSeries>();
  for (const row of parseOecdCsv(text, ["METHODOLOGY", "EXPENDITURE"])) {
    const country = row["REF_AREA"] ?? "";
    if (
      !countries.has(country) ||
      row["DATAFLOW"] !== "OECD.SDD.TPS:DSD_PRICES@DF_PRICES_ALL(1.0)" ||
      row["FREQ"] !== "M" ||
      row["METHODOLOGY"] !== "N" ||
      row["MEASURE"] !== "CPI" ||
      row["UNIT_MEASURE"] !== "PA" ||
      row["EXPENDITURE"] !== "_TXCP01_NRG" ||
      row["ADJUSTMENT"] !== "N" ||
      row["TRANSFORMATION"] !== "GY"
    )
      throw new Error("OECD 核心通胀数据维度不匹配");
    const point = observation(row, "M", fetchedAt);
    if (!point) continue;
    const series =
      grouped.get(country) ??
      makeSeries(
        country,
        "coreInflation",
        "M",
        "percent",
        "NSA",
        OECD_CORE_URL,
        `OECD.SDD.TPS:DSD_PRICES@DF_PRICES_ALL(1.0)/${country}.M.N.CPI.PA._TXCP01_NRG.N.GY`,
        fetchedAt,
        `剔除食品和能源的消费者价格同比变化率，未经季节调整；不是环比折年率。与各国自行定义的“核心 CPI”范围可能不同。${country === "JPN" ? " 日本该 COICOP1999 序列截止 2021-06，属于过期历史序列，不用于当前判断。" : ""} CSV 未提供原始发布日期，来源更新时间留空。`,
      );
    addPoint(series, point);
    grouped.set(country, series);
  }
  return [...grouped.values()].map((series) => ({
    ...series,
    observations: series.observations.sort((a, b) => a.period.localeCompare(b.period)),
  }));
}

/** Current COICOP2018 continuation avoids publishing Japan's obsolete COICOP1999 CPI as current. */
export function parseOecdJapanPricesCsv(text: string, fetchedAt: string): CycleSeries[] {
  validTimestamp(fetchedAt);
  const grouped = new Map<string, CycleSeries>();
  for (const row of parseOecdCsv(text, ["METHODOLOGY", "EXPENDITURE"])) {
    const expenditure = row["EXPENDITURE"];
    if (
      row["REF_AREA"] !== "JPN" ||
      row["DATAFLOW"] !== "OECD.SDD.TPS:DSD_PRICES_COICOP2018@DF_PRICES_C2018_ALL(1.0)" ||
      row["FREQ"] !== "M" ||
      row["METHODOLOGY"] !== "N" ||
      row["MEASURE"] !== "CPI" ||
      row["UNIT_MEASURE"] !== "PA" ||
      !["_T", "_TXCP01_NRG"].includes(expenditure ?? "") ||
      row["ADJUSTMENT"] !== "N" ||
      row["TRANSFORMATION"] !== "GY"
    )
      throw new Error("OECD 日本 CPI 数据维度不匹配");
    const point = observation(row, "M", fetchedAt);
    if (!point) continue;
    const indicator = expenditure === "_T" ? "inflation" : "coreInflation";
    const series =
      grouped.get(indicator) ??
      makeSeries(
        "JPN",
        indicator,
        "M",
        "percent",
        "NSA",
        OECD_JAPAN_PRICES_URL,
        `OECD.SDD.TPS:DSD_PRICES_COICOP2018@DF_PRICES_C2018_ALL(1.0)/JPN.M.N.CPI.PA.${expenditure}.N.GY`,
        fetchedAt,
        `日本 CPI 月度同比，采用 OECD 当前 COICOP2018 分类序列，未经季调；${indicator === "coreInflation" ? "剔除全部食品和能源，不等同日本官方常见的仅剔除生鲜食品核心口径。" : "全部消费项目。"} 不与过期 COICOP1999 序列拼接；CSV 未提供原始发布日期，来源更新时间留空。`,
      );
    addPoint(series, point);
    grouped.set(indicator, series);
  }
  return [...grouped.values()].map((series) => ({
    ...series,
    observations: series.observations.sort((a, b) => a.period.localeCompare(b.period)),
  }));
}

async function requestCsv(url: string, signal?: AbortSignal): Promise<string> {
  const timeout = AbortSignal.timeout(60_000);
  const response = await fetch(url, {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    headers: { Accept: "text/csv" },
  });
  if (!response.ok)
    throw new Error(`OECD 数据请求失败（HTTP ${response.status}），请保留已有快照后重试`);
  return response.text();
}

/** Four batched requests; never runs automatically on page mount. OECD limits downloads to 60/hour. */
export async function fetchOecdCycleSnapshot(signal?: AbortSignal): Promise<CycleSnapshot> {
  const cli = await requestCsv(OECD_CLI_URL, signal),
    kei = await requestCsv(OECD_KEI_URL, signal),
    core = await requestCsv(OECD_CORE_URL, signal),
    japanPrices = await requestCsv(OECD_JAPAN_PRICES_URL, signal);
  const fetchedAt = new Date().toISOString();
  const earlier = [
    ...parseOecdCliCsv(cli, fetchedAt),
    ...parseOecdKeiCsv(kei, fetchedAt),
    ...parseOecdCoreCsv(core, fetchedAt),
  ];
  const series = [
    ...earlier.filter(
      (item) =>
        !(item.country === "JPN" && ["inflation", "coreInflation"].includes(item.indicator)),
    ),
    ...parseOecdJapanPricesCsv(japanPrices, fetchedAt),
  ];
  if (
    series.filter((item) => item.indicator === "cli").length !== OECD_CYCLE_COUNTRIES.length ||
    series.length < 20
  )
    throw new Error("OECD 返回的国家或指标覆盖不完整，已有快照应保留");
  return { version: 1, fetchedAt, series };
}
