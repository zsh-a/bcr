import { MACRO_COUNTRY_NAMES, MACRO_END_YEAR, MACRO_INDICATORS, MACRO_START_YEAR } from "./catalog";
import type { MacroCountry, MacroIndicatorId, MacroSnapshot } from "./model";

const ENDPOINT = "https://api.worldbank.org/v2";
const indicatorIds = new Map(MACRO_INDICATORS.map((item) => [item.code, item.id]));
const displayNames = new Intl.DisplayNames(["zh-CN"], { type: "region" });

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("世界银行返回了无效数据对象");
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`世界银行缺少 ${field}`);
  return value;
}

export function parseWorldBankPage(value: unknown): {
  metadata: Record<string, unknown>;
  rows: unknown[];
} {
  if (!Array.isArray(value) || value.length !== 2 || !Array.isArray(value[1])) {
    throw new Error("世界银行接口未返回有效分页数据，请稍后重试");
  }
  const metadata = object(value[0]);
  if (
    !Number.isInteger(metadata["pages"]) ||
    (metadata["pages"] as number) < 1 ||
    !Number.isInteger(metadata["page"]) ||
    (metadata["page"] as number) < 1 ||
    (metadata["page"] as number) > (metadata["pages"] as number) ||
    !Number.isInteger(metadata["total"]) ||
    (metadata["total"] as number) < 0
  ) {
    throw new Error("世界银行分页元数据无效");
  }
  return { metadata, rows: value[1] as unknown[] };
}

export function parseWorldBankCountries(rows: unknown[]): MacroCountry[] {
  const countries = rows.flatMap((value) => {
    const row = object(value),
      region = object(row["region"]);
    if (region["id"] === "NA" || region["value"] === "Aggregates") return [];
    const id = text(row["id"], "country.id"),
      iso2 = text(row["iso2Code"], "iso2Code");
    if (!/^[A-Z]{3}$/u.test(id) || !/^[A-Z]{2}$/u.test(iso2)) return [];
    const englishName = text(row["name"], "country.name");
    return [
      {
        id,
        iso2,
        name: MACRO_COUNTRY_NAMES[id] ?? displayNames.of(iso2) ?? englishName,
        englishName,
        region: text(region["value"], "region.value"),
      },
    ];
  });
  if (
    countries.length === 0 ||
    new Set(countries.map((country) => country.id)).size !== countries.length
  ) {
    throw new Error("世界银行国家目录为空或含重复条目");
  }
  return countries.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

export function parseWorldBankObservations(
  rows: unknown[],
  countries: MacroCountry[],
  fetchedAt: string,
  sourceUpdatedAt: string,
): MacroSnapshot {
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(sourceUpdatedAt) ||
    !Number.isFinite(Date.parse(sourceUpdatedAt))
  ) {
    throw new Error("世界银行缺少来源更新日期");
  }
  const countryIds = new Set(countries.map((country) => country.id));
  const records = new Map<string, Map<number, number | null>>();
  for (const value of rows) {
    const row = object(value),
      country = row["countryiso3code"];
    if (typeof country !== "string") throw new Error("世界银行缺少 countryiso3code");
    // Aggregate rows sometimes use an empty ISO3 code; they are outside our country catalog.
    if (!countryIds.has(country)) continue;
    const code = text(object(row["indicator"])["id"], "indicator.id"),
      indicator = indicatorIds.get(code);
    if (indicator === undefined) throw new Error(`世界银行返回了未请求的指标 ${code}`);
    const date = text(row["date"], "date"),
      year = Number(date),
      observation = row["value"];
    if (!/^\d{4}$/u.test(date) || year < MACRO_START_YEAR || year > MACRO_END_YEAR)
      throw new Error("世界银行观测年份超出请求范围");
    if (
      observation !== null &&
      (typeof observation !== "number" || !Number.isFinite(observation))
    ) {
      throw new Error("世界银行观测值不是有效数值或 null");
    }
    const key = `${country}:${indicator}`,
      values = records.get(key) ?? new Map();
    if (values.has(year)) throw new Error(`世界银行返回重复观测 ${key}:${year}`);
    values.set(year, observation as number | null);
    records.set(key, values);
  }
  if (records.size === 0) throw new Error("世界银行没有返回所选国家的观测数据");
  return {
    version: 1,
    fetchedAt,
    sourceUpdatedAt,
    countries,
    series: countries.flatMap((country) =>
      MACRO_INDICATORS.map((indicator) => ({
        country: country.id,
        indicator: indicator.id as MacroIndicatorId,
        sourceUpdatedAt,
        fetchedAt,
        observations: Array.from({ length: MACRO_END_YEAR - MACRO_START_YEAR + 1 }, (_, offset) => {
          const year = MACRO_START_YEAR + offset;
          return { year, value: records.get(`${country.id}:${indicator.id}`)?.get(year) ?? null };
        }),
      })),
    ),
  };
}

async function requestPage(
  url: string,
  signal?: AbortSignal,
): Promise<ReturnType<typeof parseWorldBankPage>> {
  const timeout = AbortSignal.timeout(45_000),
    requestSignal = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
  const response = await fetch(url, {
    signal: requestSignal,
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`世界银行接口暂不可用（HTTP ${response.status}）`);
  return parseWorldBankPage(await response.json());
}

/** Empty selection downloads the global catalog; callers should refresh only selected countries. */
export async function fetchWorldBankSnapshot(
  countryIds: string[],
  signal?: AbortSignal,
): Promise<MacroSnapshot> {
  const ids = [...new Set(countryIds.map((id) => id.toUpperCase()))];
  if (ids.some((id) => !/^[A-Z]{3}$/u.test(id))) throw new Error("国家代码必须为 ISO3 大写字母");
  const directory = await requestPage(`${ENDPOINT}/country?format=json&per_page=400`, signal);
  if (
    directory.metadata["page"] !== 1 ||
    directory.metadata["pages"] !== 1 ||
    directory.metadata["total"] !== directory.rows.length
  )
    throw new Error("世界银行国家目录不完整，请重试");
  const catalog = parseWorldBankCountries(directory.rows),
    selected = new Set(ids);
  if (ids.some((id) => !catalog.some((country) => country.id === id)))
    throw new Error("所选国家不在世界银行目录中");
  const countries =
    ids.length === 0 ? catalog : catalog.filter((country) => selected.has(country.id));
  const selector = ids.length === 0 ? "all" : ids.join(";");
  const codes = MACRO_INDICATORS.map((indicator) => indicator.code).join(";");
  const url = `${ENDPOINT}/country/${selector}/indicator/${codes}?source=2&date=${MACRO_START_YEAR}:${MACRO_END_YEAR}&format=json&per_page=20000`;
  const first = await requestPage(url, signal),
    rows = [...first.rows];
  const pages = first.metadata["pages"] as number,
    total = first.metadata["total"] as number;
  if (first.metadata["page"] !== 1) throw new Error("世界银行首个分页编号无效");
  if (pages > 12) throw new Error("世界银行分页数量异常，已停止下载");
  let sourceUpdatedAt = text(first.metadata["lastupdated"], "lastupdated");
  for (let page = 2; page <= pages; page += 1) {
    const next = await requestPage(`${url}&page=${page}`, signal);
    if (
      next.metadata["pages"] !== pages ||
      next.metadata["page"] !== page ||
      next.metadata["total"] !== total
    )
      throw new Error("世界银行分页在下载期间发生变化");
    const updated = text(next.metadata["lastupdated"], "lastupdated");
    if (updated !== sourceUpdatedAt)
      throw new Error("世界银行数据在下载期间发生修订，请重试以获得一致快照");
    sourceUpdatedAt = updated;
    rows.push(...next.rows);
  }
  if (rows.length !== total) throw new Error("世界银行返回的观测记录不完整，请重试以保留已有数据");
  return parseWorldBankObservations(rows, countries, new Date().toISOString(), sourceUpdatedAt);
}
