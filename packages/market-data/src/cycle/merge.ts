import { observationMonth } from "./analysis";
import type { CycleSeries, CycleSnapshot } from "./model";

const latestPeriod = (series: CycleSeries) =>
  series.observations
    .filter((point) => point.value !== null)
    .map((point) =>
      point.period.length === 10 ? point.period : `${observationMonth(point.period)}-31`,
    )
    .sort()
    .at(-1) ?? "";
/** Choose complete series, never splice incompatible price bases or seasonal adjustments. */
export function mergeCycleSnapshots(...snapshots: CycleSnapshot[]): CycleSnapshot {
  const series = new Map<string, CycleSeries>();
  for (const snapshot of snapshots)
    for (const item of snapshot.series) {
      const key = `${item.country}:${item.indicator}`,
        previous = series.get(key);
      if (
        !previous ||
        latestPeriod(item) > latestPeriod(previous) ||
        (latestPeriod(item) === latestPeriod(previous) &&
          Date.parse(item.fetchedAt) > Date.parse(previous.fetchedAt))
      )
        series.set(key, item);
    }
  return {
    version: 1,
    fetchedAt:
      snapshots
        .map((snapshot) => snapshot.fetchedAt)
        .sort()
        .at(-1) ?? "",
    series: [...series.values()],
  };
}
