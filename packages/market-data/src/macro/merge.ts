import type { MacroSeries, MacroSnapshot } from "./model";

function effectiveSeries(series: MacroSeries, snapshot: MacroSnapshot): MacroSeries {
  return {
    ...series,
    sourceUpdatedAt: series.sourceUpdatedAt ?? snapshot.sourceUpdatedAt,
    fetchedAt: series.fetchedAt ?? snapshot.fetchedAt,
  };
}

function compareProvenance(left: MacroSeries, right: MacroSeries): number {
  const source = (left.sourceUpdatedAt ?? "").localeCompare(right.sourceUpdatedAt ?? "");
  return source || Date.parse(left.fetchedAt ?? "") - Date.parse(right.fetchedAt ?? "");
}

/**
 * Merge bundled, cached and manually refreshed series by their original provenance.
 * A recently fetched cache may still contain older unrefreshed countries. Complete
 * newer series, including explicit null corrections, replace only their own key.
 */
export function mergeMacroSnapshots(base: MacroSnapshot, incoming: MacroSnapshot): MacroSnapshot {
  const countries = new Map(base.countries.map((country) => [country.id, country]));
  for (const country of incoming.countries) {
    if (!countries.has(country.id)) countries.set(country.id, country);
  }
  const series = new Map<string, MacroSeries>();
  for (const item of base.series) {
    series.set(`${item.country}:${item.indicator}`, effectiveSeries(item, base));
  }
  for (const item of incoming.series) {
    const candidate = effectiveSeries(item, incoming),
      key = `${item.country}:${item.indicator}`;
    const existing = series.get(key);
    if (existing === undefined || compareProvenance(candidate, existing) > 0)
      series.set(key, candidate);
  }
  return {
    version: 1,
    // Summary dates identify the most recent fetch/source present, not every country's vintage.
    fetchedAt:
      Date.parse(incoming.fetchedAt) > Date.parse(base.fetchedAt)
        ? incoming.fetchedAt
        : base.fetchedAt,
    sourceUpdatedAt:
      incoming.sourceUpdatedAt > base.sourceUpdatedAt
        ? incoming.sourceUpdatedAt
        : base.sourceUpdatedAt,
    countries: [...countries.values()],
    series: [...series.values()],
  };
}
