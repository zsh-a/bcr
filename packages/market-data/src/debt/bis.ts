import type { DebtIndicatorId, DebtObservation, DebtSeries, DebtSnapshot } from "./model";

const origin = "https://stats.bis.org/api/v2/data/dataflow/BIS";
const selection = "CN+US+JP+DE+GB";
const timeFilter = "?c%5BTIME_PERIOD%5D=ge:1990-Q1";
export const BIS_DEBT_URLS = {
  credit: `${origin}/WS_TC/2.0/Q.${selection}.H+N+G+P.A.M+N.770.A${timeFilter}`,
  stock: `${origin}/WS_TC/2.0/Q.${selection}.P.A.M.XDC.A${timeFilter}`,
  service: `${origin}/WS_DSR/1.0/Q.${selection}.P+H+N${timeFilter}`,
  gap: `${origin}/WS_CREDIT_GAP/1.0/Q.${selection}.P.A.C${timeFilter}`,
} as const;
export const BIS_DEBT_ACCEPT = "application/vnd.sdmx.data+csv;version=1.0.0";
const licenseUrl = "https://data.bis.org/help/legal";
const countryIds: Readonly<Record<string, string>> = {
  CN: "CHN",
  US: "USA",
  JP: "JPN",
  DE: "DEU",
  GB: "GBR",
};
type CsvRow = Record<string, string>;

export function parseBisCsv(text: string, dimensions: string[]): CsvRow[] {
  const records: string[][] = [];
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
        if (row.some(Boolean)) records.push(row);
        row = [];
      }
    } else field += char;
  }
  if (quoted) throw new Error("BIS CSV 引号未闭合");
  if (field || row.length) {
    row.push(field.replace(/\r$/u, ""));
    records.push(row);
  }
  const header = records.shift()?.map((column) => column.replace(/^\uFEFF/u, ""));
  const required = [
    "DATAFLOW",
    "FREQ",
    "BORROWERS_CTY",
    "TIME_PERIOD",
    "OBS_VALUE",
    "UNIT_MEASURE",
    "UNIT_MULT",
    "OBS_STATUS",
    ...dimensions,
  ];
  if (
    !header ||
    new Set(header).size !== header.length ||
    required.some((column) => !header.includes(column))
  )
    throw new Error("BIS CSV 缺少数据维度");
  return records.map((values) => {
    if (values.length !== header.length) throw new Error("BIS CSV 列数不一致");
    return Object.fromEntries(header.map((column, index) => [column, values[index] ?? ""]));
  });
}
function validateFetchedAt(fetchedAt: string) {
  const date = fetchedAt.slice(0, 10),
    parsed = Date.parse(`${date}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}/u.test(fetchedAt) ||
    !Number.isFinite(Date.parse(fetchedAt)) ||
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString().slice(0, 10) !== date
  )
    throw new Error("BIS 抓取时间无效");
}
function common(
  row: CsvRow,
  flow: string,
  unit: string,
  fetchedAt: string,
  unitMultiplier = "0",
): { country: string; point: DebtObservation } | undefined {
  const country = countryIds[row["BORROWERS_CTY"] ?? ""];
  if (
    !country ||
    row["DATAFLOW"] !== flow ||
    row["FREQ"] !== "Q" ||
    row["UNIT_MEASURE"] !== unit ||
    row["UNIT_MULT"] !== unitMultiplier
  )
    throw new Error("BIS 国家、数据流、频率或单位不匹配");
  const period = row["TIME_PERIOD"] ?? "",
    match = /^(\d{4})-Q([1-4])$/u.exec(period);
  if (!match) throw new Error("BIS 季度日期无效");
  const endDate = new Date(Date.UTC(Number(match[1]), Number(match[2]) * 3, 0))
    .toISOString()
    .slice(0, 10);
  const status = row["OBS_STATUS"] ?? "";
  // OBS_CONF=F means free/public, whereas OBS_STATUS=F means a forecast.
  if (
    period < "1990-Q1" ||
    endDate > fetchedAt.slice(0, 10) ||
    status
      .split(",")
      .map((part) => part.trim())
      .includes("F") ||
    ["C", "D", "N", "S"].includes(row["OBS_CONF"] ?? "")
  )
    return undefined;
  const raw = row["OBS_VALUE"] ?? "";
  const numeric = raw === "" || raw === "NA" || raw === "NaN" ? null : Number(raw);
  if (
    numeric !== null &&
    (!Number.isFinite(numeric) || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(raw))
  )
    throw new Error("BIS 观测值无效");
  const point: DebtObservation = status
    ? { period, value: numeric, status }
    : { period, value: numeric };
  return { country, point };
}
function createSeries(
  country: string,
  indicator: DebtIndicatorId,
  unit: DebtSeries["unit"],
  valuation: DebtSeries["valuation"],
  url: string,
  seriesCode: string,
  fetchedAt: string,
  note: string,
): DebtSeries {
  return {
    country,
    indicator,
    frequency: "Q",
    unit,
    currency: null,
    seasonalAdjustment: "NSA",
    valuation,
    source: { name: "BIS Data Portal", url, seriesCode, licenseUrl },
    fetchedAt,
    sourceUpdatedAt: null,
    note: `${note} 季度、未经季调。API CSV 未提供原始发布或修订日期，来源更新时间留空；历史值可能修订。`,
    observations: [],
  };
}
function add(series: DebtSeries, point: DebtObservation): void {
  const existing = series.observations.find((item) => item.period === point.period);
  if (existing && (existing.value !== point.value || existing.status !== point.status))
    throw new Error("BIS 同期观测冲突");
  if (!existing) series.observations.push(point);
}
const sorted = (series: Iterable<DebtSeries>) =>
  [...series].map((item) => ({
    ...item,
    observations: item.observations.sort((a, b) => a.period.localeCompare(b.period)),
  }));

const debtIndicators: Readonly<Record<string, DebtIndicatorId>> = {
  H: "householdDebt",
  N: "corporateDebt",
  G: "governmentDebt",
  P: "privateDebt",
};
const debtNotes: Readonly<Record<string, string>> = {
  H: "住户及为住户服务的非营利机构（NPISH）核心债务，来自境内外全部部门的融资，未合并总额；不扣除金融资产。",
  N: "非金融企业（SNA S.11）核心债务，包括公共和私人非金融企业，不是仅民营企业；未合并总额，不扣除资产。",
  G: "一般政府合并核心债务（贷款、债务证券及通货存款），不等于全部公共部门或所有政府隐性负债。优先整条名义估值序列，不以市场值拼接较早历史。",
  P: "BIS 私营非金融部门（PNFS）核心债务＝住户及NPISH＋非金融企业；其中非金融企业含公共和私人企业，并非纯民营口径。未合并总额。",
};
export function parseBisCreditCsv(text: string, fetchedAt: string): DebtSeries[] {
  validateFetchedAt(fetchedAt);
  const candidates = new Map<string, DebtSeries>();
  for (const row of parseBisCsv(text, [
    "TC_BORROWERS",
    "TC_LENDERS",
    "VALUATION",
    "UNIT_TYPE",
    "TC_ADJUST",
  ])) {
    const borrower = row["TC_BORROWERS"] ?? "",
      indicator = debtIndicators[borrower],
      valuation = row["VALUATION"];
    if (
      !indicator ||
      row["TC_LENDERS"] !== "A" ||
      row["UNIT_TYPE"] !== "770" ||
      row["TC_ADJUST"] !== "A" ||
      !["M", "N"].includes(valuation ?? "")
    )
      throw new Error("BIS 总信用部门、估值或口径不匹配");
    const parsed = common(row, "BIS:WS_TC(2.0)", "367", fetchedAt);
    if (!parsed) continue;
    if (borrower !== "G" && valuation !== "M") continue;
    const key = `${parsed.country}:${indicator}:${valuation}`;
    const item =
      candidates.get(key) ??
      createSeries(
        parsed.country,
        indicator,
        "percentGdp",
        valuation === "N" ? "nominal" : "market",
        BIS_DEBT_URLS.credit,
        `BIS:WS_TC(2.0)/Q.${row["BORROWERS_CTY"]}.${borrower}.A.${valuation}.770.A`,
        fetchedAt,
        `${debtNotes[borrower]} 单位为季度末债务占过去四季GDP之和的百分比。TC_ADJUST=A仅表示断点调整，不是季调。估值：${valuation === "N" ? "名义值" : "市场值"}。`,
      );
    add(item, parsed.point);
    candidates.set(key, item);
  }
  const selected = new Map<string, DebtSeries>();
  for (const item of candidates.values()) {
    const key = `${item.country}:${item.indicator}`,
      previous = selected.get(key);
    const hasValue = item.observations.some((point) => point.value !== null);
    if (
      !previous ||
      (item.indicator === "governmentDebt" &&
        hasValue &&
        (!previous.observations.some((point) => point.value !== null) ||
          item.valuation === "nominal"))
    )
      selected.set(key, item);
  }
  for (const item of selected.values())
    if (item.indicator === "governmentDebt" && item.valuation === "market")
      item.note += " 本次来源无可用的非空名义序列，整条采用市场估值，不与名义值拼接。";
  return sorted(selected.values());
}

const currencies: Readonly<Record<string, string>> = {
  CN: "CNY",
  US: "USD",
  JP: "JPY",
  DE: "EUR",
  GB: "GBP",
};
/** Original break-adjusted stocks only; strict four-quarter growth belongs in the analysis layer. */
export function parseBisPrivateStockCsv(text: string, fetchedAt: string): DebtSeries[] {
  validateFetchedAt(fetchedAt);
  const series = new Map<string, DebtSeries>();
  for (const row of parseBisCsv(text, [
    "TC_BORROWERS",
    "TC_LENDERS",
    "VALUATION",
    "UNIT_TYPE",
    "TC_ADJUST",
  ])) {
    if (
      row["TC_BORROWERS"] !== "P" ||
      row["TC_LENDERS"] !== "A" ||
      row["VALUATION"] !== "M" ||
      row["UNIT_TYPE"] !== "XDC" ||
      row["TC_ADJUST"] !== "A"
    )
      throw new Error("BIS 本币信用余额口径不匹配");
    const currency = currencies[row["BORROWERS_CTY"] ?? ""] ?? "";
    const parsed = common(row, "BIS:WS_TC(2.0)", currency, fetchedAt, "9");
    if (!parsed) continue;
    const item =
      series.get(parsed.country) ??
      createSeries(
        parsed.country,
        "privateCreditStock",
        "billionLocal",
        "market",
        BIS_DEBT_URLS.stock,
        `BIS:WS_TC(2.0)/Q.${row["BORROWERS_CTY"]}.P.A.M.XDC.A`,
        fetchedAt,
        "BIS 原始私营非金融部门（住户＋含公共/私人企业的NFC）信用余额，单位为十亿本币（UNIT_MULT=9），市场估值、断点调整。XDC 的历史币制按BIS固定平价换算为当前本币；不是不变价。A不表示额外汇率调整或季调，不同本币金额不能直接跨国比较。此处保留原始余额，未伪装官方信用同比或信用脉冲。",
      );
    item.currency = currency;
    add(item, parsed.point);
    series.set(parsed.country, item);
  }
  return sorted(series.values());
}

const serviceIndicators: Readonly<Record<string, DebtIndicatorId>> = {
  P: "debtService",
  H: "householdDebtService",
  N: "corporateDebtService",
};
export function parseBisDebtServiceCsv(text: string, fetchedAt: string): DebtSeries[] {
  validateFetchedAt(fetchedAt);
  const series = new Map<string, DebtSeries>();
  for (const row of parseBisCsv(text, ["DSR_BORROWERS"])) {
    const borrower = row["DSR_BORROWERS"] ?? "",
      indicator = serviceIndicators[borrower];
    if (!indicator) throw new Error("BIS 偿债率部门不匹配");
    const parsed = common(row, "BIS:WS_DSR(1.0)", "367", fetchedAt);
    if (!parsed) continue;
    const key = `${parsed.country}:${indicator}`;
    const item =
      series.get(key) ??
      createSeries(
        parsed.country,
        indicator,
        "percentIncome",
        "notApplicable",
        BIS_DEBT_URLS.service,
        `BIS:WS_DSR(1.0)/Q.${row["BORROWERS_CTY"]}.${borrower}`,
        fetchedAt,
        `BIS 估算的${borrower === "H" ? "住户及NPISH" : borrower === "N" ? "非金融企业（含公共和私人企业）" : "私营非金融部门（住户＋含公共和私人企业的NFC）"}债务偿付额（利息＋本金摊还）占可用于偿债收入的百分比；不是利息/GDP。使用统一期限等简化假设，适合观察本国相对历史均值变化，不应用于跨国绝对水平排名。中国未提供住户和企业细分时保留缺口。`,
      );
    add(item, parsed.point);
    series.set(key, item);
  }
  return sorted(series.values());
}

export function parseBisCreditGapCsv(text: string, fetchedAt: string): DebtSeries[] {
  validateFetchedAt(fetchedAt);
  const series = new Map<string, DebtSeries>();
  for (const row of parseBisCsv(text, ["TC_BORROWERS", "TC_LENDERS", "CG_DTYPE"])) {
    if (row["TC_BORROWERS"] !== "P" || row["TC_LENDERS"] !== "A" || row["CG_DTYPE"] !== "C")
      throw new Error("BIS 信用缺口不是实际值减趋势口径");
    const parsed = common(row, "BIS:WS_CREDIT_GAP(1.0)", "770", fetchedAt);
    if (!parsed) continue;
    const item =
      series.get(parsed.country) ??
      createSeries(
        parsed.country,
        "creditGap",
        "percentagePoints",
        "notApplicable",
        BIS_DEBT_URLS.gap,
        `BIS:WS_CREDIT_GAP(1.0)/Q.${row["BORROWERS_CTY"]}.P.A.C`,
        fetchedAt,
        "BIS 官方信用/GDP缺口＝私营非金融部门信用/GDP－单边HP长期趋势，单位为GDP百分点。CG_DTYPE=C（actual−trend），不是信用/GDP实际值、GDP增速或信用脉冲。可作风险背景，不能机械判定危机时点。",
      );
    add(item, parsed.point);
    series.set(parsed.country, item);
  }
  return sorted(series.values());
}

async function requestCsv(url: string, signal?: AbortSignal): Promise<string> {
  const timeout = AbortSignal.timeout(60_000);
  const response = await fetch(url, {
    headers: { Accept: BIS_DEBT_ACCEPT },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok)
    throw new Error(`BIS 数据请求失败（HTTP ${response.status}），请保留已有快照后重试`);
  return response.text();
}
/** Explicit ingestion only; the browser loads a separately bundled frozen resource. */
export async function fetchBisDebtSnapshot(signal?: AbortSignal): Promise<DebtSnapshot> {
  const credit = await requestCsv(BIS_DEBT_URLS.credit, signal);
  const stock = await requestCsv(BIS_DEBT_URLS.stock, signal);
  const service = await requestCsv(BIS_DEBT_URLS.service, signal);
  const gap = await requestCsv(BIS_DEBT_URLS.gap, signal);
  const fetchedAt = new Date().toISOString();
  const series = [
    ...parseBisCreditCsv(credit, fetchedAt),
    ...parseBisPrivateStockCsv(stock, fetchedAt),
    ...parseBisDebtServiceCsv(service, fetchedAt),
    ...parseBisCreditGapCsv(gap, fetchedAt),
  ];
  const complete = Object.values(countryIds).every((country) =>
    [
      "householdDebt",
      "corporateDebt",
      "governmentDebt",
      "privateDebt",
      "privateCreditStock",
      "debtService",
      "creditGap",
    ].every((indicator) =>
      series.some(
        (item) =>
          item.country === country &&
          item.indicator === indicator &&
          item.observations.some((point) => point.value !== null),
      ),
    ),
  );
  if (!complete) throw new Error("BIS 必需部门或国家覆盖不完整，请保留已有快照");
  // Keep original XDC stocks separate; never turn debt/GDP ratio growth into creditGrowth/Impulse.
  return { version: 1, fetchedAt, series };
}
