import { CYCLE_INDICATORS } from "./catalog";
import type { CycleSeries, CycleSnapshot } from "./model";

const indicatorIds = new Set(CYCLE_INDICATORS.map((indicator) => indicator.id));
const https = (value: unknown) => typeof value === "string" && value.startsWith("https://");
const calendarDate = (value: string) => {
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const isoDate = (value: unknown) =>
  typeof value === "string" &&
  calendarDate(value.slice(0, 10)) &&
  Number.isFinite(Date.parse(value));
export function parseCycleSnapshot(input: unknown): CycleSnapshot {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("周期快照对象无效");
  const value = input as Record<string, unknown>;
  if (value["version"] !== 1 || !isoDate(value["fetchedAt"]) || !Array.isArray(value["series"]))
    throw new Error("周期快照版本或元数据无效");
  const keys = new Set<string>();
  const series = value["series"].map((raw: unknown) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("周期序列无效");
    const item = raw as CycleSeries;
    if (
      !/^[A-Z]{3}$/u.test(item.country) ||
      !indicatorIds.has(item.indicator) ||
      !["M", "Q", "W", "D"].includes(item.frequency) ||
      ![
        "index",
        "percent",
        "percentagePoints",
        "thousandPersons",
        "persons",
        "billionsUsd",
        "thousandUnits",
        "hours",
        "ratio",
      ].includes(item.unit) ||
      !["SA", "NSA", "notApplicable"].includes(item.seasonalAdjustment) ||
      !isoDate(item.fetchedAt) ||
      (item.sourceUpdatedAt !== null && !isoDate(item.sourceUpdatedAt)) ||
      !Array.isArray(item.observations) ||
      !item.source ||
      typeof item.source.name !== "string" ||
      !https(item.source.url) ||
      typeof item.source.seriesCode !== "string" ||
      (item.source.licenseUrl !== undefined && !https(item.source.licenseUrl)) ||
      (item.note !== undefined && typeof item.note !== "string")
    )
      throw new Error("周期序列元数据无效");
    const key = `${item.country}:${item.indicator}`;
    if (keys.has(key)) throw new Error("周期序列重复");
    keys.add(key);
    const periods = new Set<string>();
    for (const point of item.observations) {
      const validPeriod =
        item.frequency === "M"
          ? /^\d{4}-(0[1-9]|1[0-2])$/u.test(point.period)
          : item.frequency === "Q"
            ? /^\d{4}-Q[1-4]$/u.test(point.period)
            : calendarDate(point.period);
      if (
        !validPeriod ||
        periods.has(point.period) ||
        (point.value !== null &&
          (typeof point.value !== "number" || !Number.isFinite(point.value))) ||
        (point.status !== undefined && typeof point.status !== "string")
      )
        throw new Error("周期观测的日期、数值或重复记录无效");
      periods.add(point.period);
    }
    return {
      ...item,
      observations: [...item.observations].sort((a, b) => a.period.localeCompare(b.period)),
    };
  });
  return { version: 1, fetchedAt: value["fetchedAt"] as string, series };
}
