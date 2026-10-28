import type { MacroIndicatorId, MacroObservation, MacroSnapshot } from "./model";

export function getMacroSeries(
  snapshot: MacroSnapshot,
  countryId: string,
  indicatorId: MacroIndicatorId,
): MacroObservation[] {
  return (
    snapshot.series.find(
      (series) => series.country === countryId && series.indicator === indicatorId,
    )?.observations ?? []
  );
}

export function latestMacroObservation(
  observations: readonly MacroObservation[],
  beforeOrAtYear = Number.POSITIVE_INFINITY,
): MacroObservation | undefined {
  let latest: MacroObservation | undefined;
  for (const observation of observations) {
    if (
      observation.year <= beforeOrAtYear &&
      observation.value !== null &&
      (latest === undefined || observation.year > latest.year)
    )
      latest = observation;
  }
  return latest;
}

const precise = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
const percent = new Intl.NumberFormat("zh-CN", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 2,
});

export function formatMacroValue(
  value: number | null,
  indicator: MacroIndicatorId,
  compact = true,
): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (indicator !== "gdp" && indicator !== "gdpPerCapita") return `${percent.format(value)}%`;
  if (!compact) return `$${precise.format(value)}`;
  const magnitude = Math.abs(value);
  if (magnitude >= 1e12) return `$${precise.format(value / 1e12)} 万亿`;
  if (magnitude >= 1e8) return `$${precise.format(value / 1e8)} 亿`;
  if (magnitude >= 1e4) return `$${precise.format(value / 1e4)} 万`;
  return `$${precise.format(value)}`;
}
