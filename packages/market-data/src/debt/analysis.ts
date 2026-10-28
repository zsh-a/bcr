import { DEBT_UNIT_LABELS } from "./catalog";
import type {
  DebtIndicatorId,
  DebtObservation,
  DebtPhasePoint,
  DebtSeries,
  DebtSnapshot,
  DebtUnit,
} from "./model";

export function debtQuarterIndex(period: string) {
  const match = /^(\d{4})-Q([1-4])$/u.exec(period);
  return match ? Number(match[1]) * 4 + Number(match[2]) - 1 : Number.NaN;
}
export function debtQuarterPeriod(index: number) {
  return `${Math.floor(index / 4)}-Q${(index % 4) + 1}`;
}
export function debtPeriodMonth(period: string) {
  return /^\d{4}$/u.test(period)
    ? `${period}-12`
    : /^\d{4}-Q[1-4]$/u.test(period)
      ? `${period.slice(0, 4)}-${String(Number(period.at(-1)) * 3).padStart(2, "0")}`
      : period;
}
export function debtMonthIndex(period: string) {
  const month = debtPeriodMonth(period);
  return Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
}
export function getDebtSeries(snapshot: DebtSnapshot, country: string, indicator: DebtIndicatorId) {
  return snapshot.series.find(
    (series) => series.country === country && series.indicator === indicator,
  );
}
export function debtExact(series: DebtSeries | undefined, period: string): number | null {
  return series?.observations.find((point) => point.period === period)?.value ?? null;
}
export function debtLatest(
  series: DebtSeries | undefined,
  period?: string,
): DebtObservation | undefined {
  return series?.observations
    .filter(
      (point) =>
        point.value !== null &&
        (!period || debtPeriodMonth(point.period) <= debtPeriodMonth(period)),
    )
    .at(-1);
}
export function debtQuarters(snapshot: DebtSnapshot, countries: string[]): string[] {
  const sets = countries.map(
    (country) =>
      new Set(
        getDebtSeries(snapshot, country, "privateDebt")
          ?.observations.filter((point) => point.value !== null)
          .map((point) => point.period) ?? [],
      ),
  );
  const union = [...new Set(sets.flatMap((set) => [...set]))].sort();
  const common = union.filter((period) => sets.every((set) => set.has(period)));
  return common.length ? common : union;
}
/** A descriptive historical baseline, never a crisis probability. Requires exactly 40 preceding quarters. */
export function debtPhasePoint(
  snapshot: DebtSnapshot,
  country: string,
  period: string,
): DebtPhasePoint | undefined {
  const index = debtQuarterIndex(period);
  if (!Number.isFinite(index)) return undefined;
  const series = getDebtSeries(snapshot, country, "debtService"),
    service = debtExact(series, period),
    gap = debtExact(getDebtSeries(snapshot, country, "creditGap"), period);
  if (service === null || gap === null) return undefined;
  const history = Array.from({ length: 40 }, (_, offset) =>
    debtExact(series, debtQuarterPeriod(index - 40 + offset)),
  );
  if (history.some((value) => value === null)) return undefined;
  const baseline = history.reduce<number>((sum, value) => sum + value!, 0) / 40;
  return {
    country,
    period,
    gap,
    service,
    baseline,
    baselineCount: 40,
    serviceDeviation: service - baseline,
  };
}
export function debtPhasePoints(snapshot: DebtSnapshot, countries: string[], periods: string[]) {
  return countries.flatMap((country) =>
    periods
      .map((period) => debtPhasePoint(snapshot, country, period))
      .filter((point): point is DebtPhasePoint => point !== undefined),
  );
}
/** Native-period null separators for chart gaps; source data and CSV remain unchanged. */
export function debtChartObservations(series: DebtSeries): DebtObservation[] {
  const result: DebtObservation[] = [],
    step = series.frequency === "Q" ? 3 : series.frequency === "A" ? 12 : 1;
  for (const point of series.observations) {
    const previous = result.at(-1);
    if (previous)
      for (
        let month = debtMonthIndex(previous.period) + step;
        month < debtMonthIndex(point.period);
        month += step
      ) {
        const year = Math.floor(month / 12),
          period =
            series.frequency === "Q"
              ? `${year}-Q${Math.floor((month % 12) / 3) + 1}`
              : series.frequency === "A"
                ? String(year)
                : `${year}-${String((month % 12) + 1).padStart(2, "0")}`;
        result.push({ period, value: null });
      }
    result.push(point);
  }
  return result;
}
const number = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
export function formatDebtValue(
  value: number | null | undefined,
  unit?: DebtUnit,
  currency?: string | null,
) {
  return value === null || value === undefined || !Number.isFinite(value)
    ? "—"
    : `${number.format(value)}${unit ? ` ${DEBT_UNIT_LABELS[unit]}${currency ? ` ${currency}` : ""}` : ""}`;
}
