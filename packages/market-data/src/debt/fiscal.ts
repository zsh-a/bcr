import type { DebtIndicatorId, DebtObservation, DebtSeries, DebtSnapshot, DebtUnit } from "./model";

export const FISCAL_START_YEAR = 2000;
export const FISCAL_COUNTRIES = ["CHN", "USA", "JPN", "DEU", "GBR"] as const;
export const FISCAL_LICENSE = "https://datacatalog.worldbank.org/public-licenses#cc-by";
export const FISCAL_DEFINITIONS: readonly {
  id: DebtIndicatorId;
  code: string;
  unit: DebtUnit;
  note: string;
}[] = [
  {
    id: "governmentInterestBurden",
    code: "GC.XPN.INTP.RV.ZS",
    unit: "percentRevenue",
    note: "GFS 利息支出占财政收入，不是扣除利息收入后的净利息负担；包含对境内外居民的政府债务利息。收入定义及预算覆盖范围因国而异。",
  },
  {
    id: "fiscalBalance",
    code: "GC.NLD.TOTL.GD.ZS",
    unit: "percentGdp",
    note: "GFS 财政净借贷（正）/净借入（负）占 GDP：收入减费用，再减非金融资产净投资；不是现金收支差，也不是初级财政余额。",
  },
];
export const FISCAL_SCOPE_NOTE =
  "来源为 IMF Government Finance Statistics，经世界银行 WDI 提供。通常覆盖中央政府：多数国家为合并中央政府，部分仅预算中央政府，可能不含社保基金；各国覆盖、收入分母和会计基础并不完全统一，不等同 BIS 一般政府，也不代表全国各级政府。年度报告值可能滞后多年；各观测原始 obs_status 如有则保留，未自行认定审定状态。未使用 WEO/财政监测的 staff estimate 或预测补齐。";

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("财政来源对象无效");
  return value as Record<string, unknown>;
}

function validDate(value: unknown, now: Date): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/u.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value &&
    value <= now.toISOString().slice(0, 10)
  );
}

function pageOf(payload: unknown): { metadata: Record<string, unknown>; rows: unknown[] } {
  if (!Array.isArray(payload) || payload.length !== 2 || !Array.isArray(payload[1]))
    throw new Error("世界银行财政接口未返回数据页");
  const metadata = record(payload[0]);
  if (Number(metadata["page"]) !== 1 || Number(metadata["pages"]) !== 1 || metadata["message"])
    throw new Error("世界银行财政分页不完整或返回错误");
  return { metadata, rows: payload[1] };
}

/** Exclude region/income aggregates using the official country catalogue. */
export function parseFiscalCountries(payload: unknown): Set<string> {
  const page = pageOf(payload),
    countries = new Set<string>();
  for (const value of page.rows) {
    const country = record(value),
      region = record(country["region"]);
    if (region["id"] === "NA") continue;
    if (typeof country["id"] !== "string" || !/^[A-Z]{3}$/u.test(country["id"]))
      throw new Error("财政国家目录代码无效");
    countries.add(country["id"]);
  }
  if (!countries.size) throw new Error("财政国家目录为空");
  return countries;
}

export function parseFiscalPayload(
  payload: unknown,
  code: string,
  countries: ReadonlySet<string>,
  fetchedAt: string,
): DebtSeries[] {
  const definition = FISCAL_DEFINITIONS.find((item) => item.code === code);
  if (!definition) throw new Error("未知财政指标");
  const now = new Date(fetchedAt);
  if (!Number.isFinite(now.getTime())) throw new Error("财政抓取日期无效");
  const { metadata, rows } = pageOf(payload);
  if (!validDate(metadata["lastupdated"], now) || String(metadata["sourceid"]) !== "2")
    throw new Error("财政来源版本或更新日期无效");
  const byCountry = new Map<string, DebtObservation[]>(),
    keys = new Set<string>();
  for (const raw of rows) {
    const row = record(raw),
      country = row["countryiso3code"];
    if (record(row["indicator"])["id"] !== code) throw new Error("财政接口返回了其他指标");
    if (typeof country !== "string") throw new Error("财政国家代码无效");
    if (!countries.has(country)) continue;
    const period = row["date"],
      value = row["value"],
      status = row["obs_status"];
    if (
      typeof period !== "string" ||
      !/^\d{4}$/u.test(period) ||
      Number(period) < FISCAL_START_YEAR ||
      Number(period) >= now.getUTCFullYear()
    )
      throw new Error("财政年份超出完整历史年度范围");
    if (value !== null && (typeof value !== "number" || !Number.isFinite(value)))
      throw new Error("财政数值无效");
    if (status !== undefined && typeof status !== "string") throw new Error("财政观测状态无效");
    const key = `${country}:${period}`;
    if (keys.has(key)) throw new Error("财政序列含重复年份");
    keys.add(key);
    const observations = byCountry.get(country) ?? [];
    observations.push({
      period,
      value: value as number | null,
      ...(typeof status === "string" && status.trim() ? { status } : {}),
    });
    byCountry.set(country, observations);
  }
  const series: DebtSeries[] = [];
  for (const [country, observations] of byCountry) {
    observations.sort((a, b) => a.period.localeCompare(b.period));
    const first = observations.findIndex((point) => point.value !== null);
    if (first === -1) continue;
    let end = observations.length;
    while (observations[end - 1]?.value === null) end -= 1;
    series.push({
      country,
      indicator: definition.id,
      frequency: "A",
      unit: definition.unit,
      currency: null,
      seasonalAdjustment: "notApplicable",
      valuation: "notApplicable",
      source: {
        name: "IMF GFS · World Bank WDI",
        url: `https://data.worldbank.org/indicator/${code}`,
        seriesCode: code,
        licenseUrl: FISCAL_LICENSE,
      },
      fetchedAt,
      sourceUpdatedAt: metadata["lastupdated"] as string,
      note: `${definition.note} ${FISCAL_SCOPE_NOTE} 口径资料：https://databank.worldbank.org/metadataglossary/world-development-indicators/series/${code}`,
      observations: observations.slice(first, end),
    });
  }
  return series.sort((a, b) => a.country.localeCompare(b.country));
}

async function fetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const timeout = AbortSignal.timeout(30_000),
    response = await fetch(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  if (!response.ok) throw new Error(`财政来源 HTTP ${response.status}`);
  const text = await response.text();
  if (text.length > 6_000_000) throw new Error("财政来源响应过大");
  return JSON.parse(text) as unknown;
}

export async function fetchFiscalDebtSnapshot(signal?: AbortSignal): Promise<DebtSnapshot> {
  if (signal?.aborted) throw signal.reason;
  const end = new Date().getUTCFullYear() - 1,
    countryCodes = FISCAL_COUNTRIES.join(";");
  const results = await Promise.allSettled([
    fetchJson(
      `https://api.worldbank.org/v2/country/${countryCodes}?format=json&per_page=500`,
      signal,
    ),
    ...FISCAL_DEFINITIONS.map((definition) =>
      fetchJson(
        `https://api.worldbank.org/v2/country/${countryCodes}/indicator/${definition.code}?source=2&date=${FISCAL_START_YEAR}:${end}&format=json&per_page=20000`,
        signal,
      ),
    ),
  ]);
  if (signal?.aborted) throw signal.reason;
  for (const result of results) if (result.status === "rejected") throw result.reason;
  const values = results.map((result) => (result as PromiseFulfilledResult<unknown>).value);
  const countries = parseFiscalCountries(values[0]),
    fetchedAt = new Date().toISOString();
  const series = FISCAL_DEFINITIONS.flatMap((definition, index) =>
    parseFiscalPayload(values[index + 1], definition.code, countries, fetchedAt),
  );
  if (!series.length) throw new Error("财政来源没有可用历史观测，未生成替代值");
  return { version: 1, fetchedAt, series };
}
