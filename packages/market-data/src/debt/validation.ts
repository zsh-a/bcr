import { DEBT_COUNTRIES, DEBT_INDICATORS } from "./catalog";
import type { DebtSeries, DebtSnapshot } from "./model";

const calendarDate = (value: string) =>
  /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/u.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const date = (value: unknown) =>
  typeof value === "string" &&
  calendarDate(value.slice(0, 10)) &&
  Number.isFinite(Date.parse(value));
const https = (value: unknown) => {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
};
export function parseDebtSnapshot(input: unknown): DebtSnapshot {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("债务资源对象无效");
  const root = input as Record<string, unknown>;
  if (root["version"] !== 1 || !date(root["fetchedAt"]) || !Array.isArray(root["series"]))
    throw new Error("债务资源版本或抓取日期无效");
  const keys = new Set<string>();
  const series = root["series"].map((raw: unknown) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("债务序列对象无效");
    const item = raw as DebtSeries;
    if (
      !DEBT_COUNTRIES.some((country) => country.id === item.country) ||
      !DEBT_INDICATORS.some((indicator) => indicator.id === item.indicator) ||
      !["Q", "M", "A"].includes(item.frequency) ||
      ![
        "percentGdp",
        "percentIncome",
        "percentRevenue",
        "percent",
        "percentagePoints",
        "trillionLocal",
        "billionLocal",
      ].includes(item.unit) ||
      (item.currency !== null &&
        (typeof item.currency !== "string" || !/^[A-Z]{3}$/u.test(item.currency))) ||
      !["SA", "NSA", "notApplicable"].includes(item.seasonalAdjustment) ||
      !["nominal", "market", "notApplicable"].includes(item.valuation) ||
      !date(item.fetchedAt) ||
      (item.sourceUpdatedAt !== null && !date(item.sourceUpdatedAt)) ||
      typeof item.note !== "string" ||
      !item.source ||
      typeof item.source.name !== "string" ||
      !item.source.name.trim() ||
      !https(item.source.url) ||
      !https(item.source.licenseUrl) ||
      typeof item.source.seriesCode !== "string" ||
      !Array.isArray(item.observations)
    )
      throw new Error("债务序列元数据无效");
    if (["trillionLocal", "billionLocal"].includes(item.unit) && item.currency === null)
      throw new Error("本币金额必须标明币种");
    const monthly = [
      "socialFinancingGrowth",
      "socialFinancingFlow",
      "governmentBondFlow",
      "corporateBondFlow",
      "rmbLoanFlow",
    ].includes(item.indicator);
    const annual = [
      "governmentInterestBurden",
      "governmentNetInterestBurden",
      "fiscalBalance",
    ].includes(item.indicator);
    const expectedFrequency = monthly ? "M" : annual ? "A" : "Q";
    const expectedUnit = [
      "householdDebt",
      "corporateDebt",
      "governmentDebt",
      "privateDebt",
      "fiscalBalance",
    ].includes(item.indicator)
      ? "percentGdp"
      : ["debtService", "householdDebtService", "corporateDebtService"].includes(item.indicator)
        ? "percentIncome"
        : ["creditGap", "creditImpulse"].includes(item.indicator)
          ? "percentagePoints"
          : ["governmentInterestBurden", "governmentNetInterestBurden"].includes(item.indicator)
            ? "percentRevenue"
            : ["creditGrowth", "socialFinancingGrowth"].includes(item.indicator)
              ? "percent"
              : item.indicator === "privateCreditStock"
                ? "billionLocal"
                : "trillionLocal";
    if (item.frequency !== expectedFrequency || item.unit !== expectedUnit)
      throw new Error("债务指标的统计频率或单位不符");
    const key = `${item.country}:${item.indicator}`;
    if (keys.has(key)) throw new Error("债务序列重复");
    keys.add(key);
    const periods = new Set<string>();
    for (const point of item.observations) {
      if (
        !point ||
        typeof point !== "object" ||
        typeof point.period !== "string" ||
        !(
          item.frequency === "Q"
            ? /^\d{4}-Q[1-4]$/u
            : item.frequency === "M"
              ? /^\d{4}-(0[1-9]|1[0-2])$/u
              : /^\d{4}$/u
        ).test(point.period) ||
        periods.has(point.period) ||
        (point.value !== null &&
          (typeof point.value !== "number" || !Number.isFinite(point.value))) ||
        (point.status !== undefined && typeof point.status !== "string")
      )
        throw new Error("债务观测日期、值或重复记录无效");
      periods.add(point.period);
    }
    return {
      ...item,
      observations: [...item.observations].sort((a, b) => a.period.localeCompare(b.period)),
    };
  });
  return { version: 1, fetchedAt: root["fetchedAt"] as string, series };
}
