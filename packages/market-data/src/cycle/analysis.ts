import { CYCLE_INDICATORS } from "./catalog";
import type {
  CycleIndicatorId,
  CycleObservation,
  CyclePhase,
  CycleSeries,
  CycleSnapshot,
  CycleSpacePoint,
  CycleUnit,
} from "./model";

export function monthIndex(period: string): number {
  const match = /^(\d{4})-(\d{2})$/u.exec(period);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) return Number.NaN;
  return Number(match[1]) * 12 + Number(match[2]) - 1;
}
export function monthPeriod(index: number): string {
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}
export function shiftMonth(period: string, amount: number): string {
  return monthPeriod(monthIndex(period) + amount);
}
export function observationMonth(period: string) {
  const quarter = /^(\d{4})-Q([1-4])$/u.exec(period);
  return quarter
    ? `${quarter[1]}-${String(Number(quarter[2]) * 3).padStart(2, "0")}`
    : period.slice(0, 7);
}
export function getCycleSeries(
  snapshot: CycleSnapshot,
  country: string,
  indicator: CycleIndicatorId,
): CycleSeries | undefined {
  return snapshot.series.find(
    (series) => series.country === country && series.indicator === indicator,
  );
}
export function cycleLatest(
  series: CycleSeries | undefined,
  period: string,
): CycleObservation | undefined {
  return series?.observations
    .filter((point) => point.value !== null && observationMonth(point.period) <= period)
    .at(-1);
}
export function cycleExact(series: CycleSeries | undefined, period: string): number | null {
  return series?.observations.find((point) => point.period === period)?.value ?? null;
}
export function cyclePhase(level: number, momentum: number): CyclePhase {
  return Math.abs(momentum) < 1e-10
    ? "flat"
    : level >= 100
      ? momentum > 0
        ? "aboveRising"
        : "aboveFalling"
      : momentum > 0
        ? "belowRising"
        : "belowFalling";
}
export function cyclePoint(
  snapshot: CycleSnapshot,
  country: string,
  period: string,
): CycleSpacePoint | undefined {
  const series = getCycleSeries(snapshot, country, "cli");
  const level = cycleExact(series, period),
    previous = cycleExact(series, shiftMonth(period, -3));
  if (level === null || previous === null) return undefined;
  const momentum = level - previous;
  return { country, period, level, momentum, phase: cyclePhase(level, momentum) };
}
export function cycleSpacePoints(
  snapshot: CycleSnapshot,
  countries: string[],
  period: string,
  months = 36,
): CycleSpacePoint[] {
  const start = monthIndex(period) - months + 1;
  return countries.flatMap((country) =>
    Array.from({ length: months }, (_, index) =>
      cyclePoint(snapshot, country, monthPeriod(start + index)),
    ).filter((point): point is CycleSpacePoint => point !== undefined),
  );
}
export function cyclePeriods(snapshot: CycleSnapshot, countries: string[]): string[] {
  const sets = countries.map(
    (country) =>
      new Set(
        getCycleSeries(snapshot, country, "cli")
          ?.observations.filter(
            (point) => point.value !== null && cyclePoint(snapshot, country, point.period),
          )
          .map((point) => point.period) ?? [],
      ),
  );
  const union = [...new Set(sets.flatMap((set) => [...set]))].sort();
  const common = union.filter((period) => sets.every((set) => set.has(period)));
  return common.length ? common : union;
}
/** Ratio of adjacent three-month means, not annualized. Missing months stay missing. */
export function threeMonthGrowth(series: CycleSeries, period: string): number | null {
  if (
    series.frequency !== "M" ||
    series.seasonalAdjustment !== "SA" ||
    series.unit === "percent" ||
    series.unit === "percentagePoints"
  )
    return null;
  const values = Array.from({ length: 6 }, (_, index) =>
    cycleExact(series, shiftMonth(period, index - 5)),
  );
  if (values.some((value) => value === null)) return null;
  const previous = (values[0]! + values[1]! + values[2]!) / 3;
  const current = (values[3]! + values[4]! + values[5]!) / 3;
  return previous === 0 ? null : (current / previous - 1) * 100;
}
export function cycleDisplayObservations(series: CycleSeries): CycleObservation[] {
  if (
    !CYCLE_INDICATORS.find((item) => item.id === series.indicator)?.indexGrowth ||
    series.unit === "percent" ||
    series.frequency !== "M"
  )
    return series.observations;
  const lookup = new Map(series.observations.map((point) => [point.period, point.value]));
  return series.observations.map((point) => {
    const previous = lookup.get(shiftMonth(point.period, -12));
    return {
      ...point,
      value:
        point.value === null || previous === undefined || previous === null || previous === 0
          ? null
          : (point.value / previous - 1) * 100,
    };
  });
}
export function cycleDisplayUnit(series: CycleSeries): CycleUnit {
  return CYCLE_INDICATORS.find((item) => item.id === series.indicator)?.indexGrowth
    ? "percent"
    : series.unit;
}
/** Chart-only null separators for omitted calendar periods. These are not new source observations. */
export function cycleChartObservations(series: CycleSeries): CycleObservation[] {
  const displayed = cycleDisplayObservations(series);
  if (series.frequency !== "M" && series.frequency !== "Q") return displayed;
  const result: CycleObservation[] = [];
  const step = series.frequency === "Q" ? 3 : 1;
  for (const point of displayed) {
    const previous = result.at(-1);
    if (previous)
      for (
        let month = monthIndex(observationMonth(previous.period)) + step;
        month < monthIndex(observationMonth(point.period));
        month += step
      ) {
        const period =
          series.frequency === "Q"
            ? `${Math.floor(month / 12)}-Q${Math.floor((month % 12) / 3) + 1}`
            : monthPeriod(month);
        result.push({ period, value: null });
      }
    result.push(point);
  }
  return result;
}
const number = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
export function formatCycleValue(
  value: number | null | undefined,
  unit: CycleUnit = "index",
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${number.format(value)}${unit === "percent" ? "%" : unit === "percentagePoints" ? " 个百分点" : unit === "persons" ? " 人" : unit === "thousandPersons" ? " 千人" : unit === "billionsUsd" ? " 十亿美元" : unit === "thousandUnits" ? " 千套" : unit === "hours" ? " 小时" : unit === "ratio" ? " 倍" : ""}`;
}
export function cycleSourceDateRange(snapshot: CycleSnapshot) {
  return [
    ...new Set(
      snapshot.series.flatMap((series) =>
        series.observations
          .filter((point) => point.value !== null)
          .map((point) => observationMonth(point.period)),
      ),
    ),
  ].sort();
}
