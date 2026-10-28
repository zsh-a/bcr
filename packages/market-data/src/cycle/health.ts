import { cycleDisplayObservations, monthIndex, observationMonth } from "./analysis";
import type { CycleSeries } from "./model";

/** Calendar coverage for M/Q only; never count weekends as missing daily observations. */
export function cycleSeriesHealth(series: CycleSeries, start: string, end: string) {
  const points = cycleDisplayObservations(series).filter(
    (point) => observationMonth(point.period) >= start && observationMonth(point.period) <= end,
  );
  const valid = points.filter((point) => point.value !== null),
    latest = [...cycleDisplayObservations(series)]
      .reverse()
      .find((point) => point.value !== null && observationMonth(point.period) <= end);
  let expected: number | null = null;
  if (series.frequency === "M") expected = Math.max(0, monthIndex(end) - monthIndex(start) + 1);
  if (series.frequency === "Q") {
    expected = 0;
    for (let month = monthIndex(start); month <= monthIndex(end); month++)
      if (month % 3 === 2) expected++;
  }
  return {
    valid: valid.length,
    reported: points.length,
    expected,
    coverage: expected ? valid.length / expected : null,
    latestPeriod: latest?.period ?? null,
    ageMonths: latest ? monthIndex(end) - monthIndex(observationMonth(latest.period)) : null,
    derived: series.source.seriesCode.includes("derived-"),
  };
}
