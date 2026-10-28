import type {
  EconomicPoint,
  EconomicQuery,
  EconomicReading,
  EconomicRepository,
  EconomicSeries,
  EconomicTrack,
} from "./model";
import {
  economicCalendarPeriods,
  economicMonthIndex,
  economicPeriodEnd,
  isEconomicDate,
  shiftEconomicPeriod,
} from "./period";

interface SeriesIndex {
  byPeriod: Map<string, EconomicPoint>;
  valid: EconomicPoint[];
}
const indexes = new WeakMap<EconomicSeries, SeriesIndex>();
function seriesIndex(series: EconomicSeries): SeriesIndex {
  let index = indexes.get(series);
  if (!index) {
    index = {
      byPeriod: new Map(series.observations.map((point) => [point.period, point])),
      valid: series.observations.filter((point) => point.value !== null),
    };
    indexes.set(series, index);
  }
  return index;
}
/** First date >= target, or > target when inclusive=true. Sorted period ends retain native dates. */
function boundary(points: EconomicPoint[], target: string, inclusive = false): number {
  let low = 0,
    high = points.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (points[middle]!.date < target || (inclusive && points[middle]!.date === target))
      low = middle + 1;
    else high = middle;
  }
  return low;
}
function latestReading(series: EconomicSeries, end: string): EconomicReading | null {
  const index = seriesIndex(series),
    point = index.valid[boundary(index.valid, end, true) - 1];
  if (!point) return null;
  const previous = index.byPeriod.get(shiftEconomicPeriod(point.period, series.frequency, -1));
  const adjacent = previous !== undefined && previous.value !== null;
  return {
    ...point,
    change: adjacent ? point.value! - previous.value! : null,
    previousPeriod: adjacent ? previous.period : null,
    ageMonths: economicMonthIndex(end) - economicMonthIndex(point.date),
  };
}
/** The cutoff constrains chart, table, CSV and readings together; no forward fill or nearest-period changes. */
export function queryEconomicTracks(
  repository: EconomicRepository,
  query: EconomicQuery,
): EconomicTrack[] {
  const [start, rangeEnd] = query.range;
  if (![start, rangeEnd, query.cutoff].every(isEconomicDate) || start > rangeEnd)
    throw new Error("经济查询需要有效且有序的 YYYY-MM-DD 日期范围与截止日期");
  const end = rangeEnd < query.cutoff ? rangeEnd : query.cutoff;
  return [...new Set(query.countries)].flatMap((country) => {
    const series = repository.getSeries(country, query.metricId);
    if (!series) return [];
    const index = seriesIndex(series);
    const points =
      end < start
        ? []
        : series.observations.slice(
            boundary(series.observations, start),
            boundary(series.observations, end, true),
          );
    const calendar = economicCalendarPeriods(start, end, series.frequency);
    const plot =
      calendar === null
        ? [...points]
        : calendar.map(
            (period) =>
              index.byPeriod.get(period) ?? {
                period,
                date: economicPeriodEnd(period, series.frequency),
                value: null,
                rawValue: null,
              },
          );
    return [
      {
        series,
        points,
        plot,
        reading: latestReading(series, end),
        coverage: {
          valid: points.filter((point) => point.value !== null).length,
          reported: points.length,
          expected: calendar?.length ?? null,
        },
      },
    ];
  });
}
