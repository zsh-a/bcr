import { debtPeriodMonth } from "./analysis";
import type { DebtSeries, DebtSnapshot } from "./model";

const latest = (series: DebtSeries) =>
  series.observations
    .filter((point) => point.value !== null)
    .map((point) => debtPeriodMonth(point.period))
    .sort()
    .at(-1) ?? "";
/** Resolve whole series. Do not splice quarterly bases or fiscal coverage. */
export function mergeDebtSnapshots(...snapshots: DebtSnapshot[]): DebtSnapshot {
  const entries = new Map<string, DebtSeries>();
  for (const snapshot of snapshots)
    for (const item of snapshot.series) {
      const key = `${item.country}:${item.indicator}`,
        previous = entries.get(key);
      if (
        !previous ||
        latest(item) > latest(previous) ||
        (latest(item) === latest(previous) &&
          Date.parse(item.fetchedAt) > Date.parse(previous.fetchedAt))
      )
        entries.set(key, item);
    }
  return {
    version: 1,
    fetchedAt:
      snapshots
        .map((snapshot) => snapshot.fetchedAt)
        .sort()
        .at(-1) ?? "",
    series: [...entries.values()],
  };
}
