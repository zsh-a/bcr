import rawSnapshot from "./worldbank-snapshot.json?raw";
import {
  MACRO_END_YEAR,
  MACRO_INDICATORS,
  MACRO_LICENSE_URL,
  MACRO_SOURCE,
  MACRO_SOURCE_URL,
  MACRO_START_YEAR,
} from "./catalog";
import type { CompactMacroSnapshot, MacroCountry, MacroIndicatorId, MacroSnapshot } from "./model";

const indicatorIds = new Set<string>(MACRO_INDICATORS.map((indicator) => indicator.id));

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("宏观快照对象无效");
  return value as Record<string, unknown>;
}

/** The compact JSON is a lossless representation of the real upstream observations. */
export function encodeMacroSnapshot(snapshot: MacroSnapshot): CompactMacroSnapshot {
  return {
    version: 1,
    source: MACRO_SOURCE,
    sourceUrl: MACRO_SOURCE_URL,
    license: MACRO_LICENSE_URL,
    fetchedAt: snapshot.fetchedAt,
    sourceUpdatedAt: snapshot.sourceUpdatedAt,
    startYear: MACRO_START_YEAR,
    endYear: MACRO_END_YEAR,
    countries: snapshot.countries.map((country) => [
      country.id,
      country.iso2,
      country.name,
      country.englishName,
      country.region,
    ]),
    series: snapshot.series.map((series) => {
      const first = series.observations.findIndex((observation) => observation.value !== null);
      if (first === -1) return [series.country, series.indicator, MACRO_START_YEAR, []];
      let end = series.observations.length;
      while (end > first && series.observations[end - 1]?.value === null) end -= 1;
      return [
        series.country,
        series.indicator,
        series.observations[first]?.year ?? MACRO_START_YEAR,
        series.observations.slice(first, end).map((observation) => observation.value),
      ];
    }),
  };
}

export function decodeMacroSnapshot(value: unknown): MacroSnapshot {
  const input = record(value);
  if (
    input["version"] !== 1 ||
    input["source"] !== MACRO_SOURCE ||
    input["startYear"] !== MACRO_START_YEAR ||
    input["endYear"] !== MACRO_END_YEAR ||
    typeof input["fetchedAt"] !== "string" ||
    !Number.isFinite(Date.parse(input["fetchedAt"])) ||
    typeof input["sourceUpdatedAt"] !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(input["sourceUpdatedAt"]) ||
    !Number.isFinite(Date.parse(input["sourceUpdatedAt"])) ||
    !Array.isArray(input["countries"]) ||
    !Array.isArray(input["series"])
  ) {
    throw new Error("宏观快照版本或元数据无效");
  }
  const countries: MacroCountry[] = input["countries"].map((country: unknown) => {
    if (
      !Array.isArray(country) ||
      country.length !== 5 ||
      country.some((field) => typeof field !== "string" || !field) ||
      !/^[A-Z]{3}$/u.test(country[0] as string) ||
      !/^[A-Z]{2}$/u.test(country[1] as string)
    )
      throw new Error("宏观快照国家目录无效");
    const [id, iso2, name, englishName, region] = country as [
      string,
      string,
      string,
      string,
      string,
    ];
    return { id, iso2, name, englishName, region };
  });
  const countryIds = new Set(countries.map((country) => country.id)),
    keys = new Set<string>();
  if (countries.length === 0 || countryIds.size !== countries.length)
    throw new Error("宏观快照国家目录为空或重复");
  const series = input["series"].map((entry: unknown) => {
    if (!Array.isArray(entry) || entry.length !== 4) throw new Error("宏观快照序列无效");
    const [country, indicator, firstYear, values] = entry as unknown[];
    if (
      typeof country !== "string" ||
      !countryIds.has(country) ||
      typeof indicator !== "string" ||
      !indicatorIds.has(indicator) ||
      typeof firstYear !== "number" ||
      !Number.isInteger(firstYear) ||
      firstYear < MACRO_START_YEAR ||
      firstYear > MACRO_END_YEAR ||
      !Array.isArray(values) ||
      firstYear + values.length - 1 > MACRO_END_YEAR ||
      values.some(
        (item: unknown) => item !== null && (typeof item !== "number" || !Number.isFinite(item)),
      )
    ) {
      throw new Error("宏观快照序列包含无效年份、指标或数值");
    }
    const key = `${country}:${indicator}`;
    if (keys.has(key)) throw new Error("宏观快照包含重复序列");
    keys.add(key);
    return {
      country,
      indicator: indicator as MacroIndicatorId,
      sourceUpdatedAt: input["sourceUpdatedAt"] as string,
      fetchedAt: input["fetchedAt"] as string,
      observations: Array.from({ length: MACRO_END_YEAR - MACRO_START_YEAR + 1 }, (_, offset) => {
        const year = MACRO_START_YEAR + offset;
        return { year, value: (values[year - firstYear] as number | null | undefined) ?? null };
      }),
    };
  });
  if (series.length !== countries.length * MACRO_INDICATORS.length)
    throw new Error("宏观快照缺少国家指标序列");
  return {
    version: 1,
    fetchedAt: input["fetchedAt"],
    sourceUpdatedAt: input["sourceUpdatedAt"],
    countries,
    series,
  };
}

/** Validate a browser cache without coercing missing values into numeric zero. */
export function parseMacroSnapshot(value: unknown): MacroSnapshot {
  const input = record(value);
  if (
    input["version"] !== 1 ||
    typeof input["fetchedAt"] !== "string" ||
    !Number.isFinite(Date.parse(input["fetchedAt"])) ||
    typeof input["sourceUpdatedAt"] !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(input["sourceUpdatedAt"]) ||
    !Number.isFinite(Date.parse(input["sourceUpdatedAt"])) ||
    !Array.isArray(input["countries"]) ||
    !Array.isArray(input["series"])
  )
    throw new Error("宏观缓存元数据无效");
  const countries = input["countries"].map((entry: unknown) => {
    const country = record(entry);
    if (
      typeof country["id"] !== "string" ||
      !/^[A-Z]{3}$/u.test(country["id"]) ||
      typeof country["iso2"] !== "string" ||
      !/^[A-Z]{2}$/u.test(country["iso2"]) ||
      ["name", "englishName", "region"].some(
        (key) => typeof country[key] !== "string" || !country[key],
      )
    )
      throw new Error("宏观缓存国家目录无效");
    return {
      id: country["id"],
      iso2: country["iso2"],
      name: country["name"] as string,
      englishName: country["englishName"] as string,
      region: country["region"] as string,
    };
  });
  const ids = new Set(countries.map((country) => country.id)),
    keys = new Set<string>();
  if (countries.length === 0 || ids.size !== countries.length)
    throw new Error("宏观缓存国家目录为空或重复");
  const series = input["series"].map((entry: unknown) => {
    const item = record(entry),
      country = item["country"],
      indicator = item["indicator"];
    if (
      typeof country !== "string" ||
      !ids.has(country) ||
      typeof indicator !== "string" ||
      !indicatorIds.has(indicator) ||
      !Array.isArray(item["observations"]) ||
      item["observations"].length !== MACRO_END_YEAR - MACRO_START_YEAR + 1
    )
      throw new Error("宏观缓存序列无效");
    const key = `${country}:${indicator}`;
    if (keys.has(key)) throw new Error("宏观缓存包含重复序列");
    keys.add(key);
    const observations = item["observations"].map((observation: unknown, index: number) => {
      const point = record(observation),
        year = MACRO_START_YEAR + index,
        numeric = point["value"];
      if (
        point["year"] !== year ||
        (numeric !== null && (typeof numeric !== "number" || !Number.isFinite(numeric)))
      )
        throw new Error("宏观缓存观测无效");
      return { year, value: numeric as number | null };
    });
    const updated = item["sourceUpdatedAt"] ?? input["sourceUpdatedAt"],
      fetched = item["fetchedAt"] ?? input["fetchedAt"];
    if (
      typeof updated !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/u.test(updated) ||
      !Number.isFinite(Date.parse(updated)) ||
      typeof fetched !== "string" ||
      !Number.isFinite(Date.parse(fetched))
    )
      throw new Error("宏观缓存序列来源日期无效");
    return {
      country,
      indicator: indicator as MacroIndicatorId,
      observations,
      sourceUpdatedAt: updated,
      fetchedAt: fetched,
    };
  });
  if (series.length !== countries.length * MACRO_INDICATORS.length)
    throw new Error("宏观缓存缺少国家指标序列");
  return {
    version: 1,
    countries,
    series,
    fetchedAt: input["fetchedAt"],
    sourceUpdatedAt: input["sourceUpdatedAt"],
  };
}

export const bundledMacroSnapshot = decodeMacroSnapshot(JSON.parse(rawSnapshot) as unknown);
export const MACRO_COUNTRIES = bundledMacroSnapshot.countries;
