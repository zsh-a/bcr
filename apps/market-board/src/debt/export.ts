import {
  DEBT_COUNTRIES,
  DEBT_INDICATORS,
  getDebtSeries,
  type DebtSnapshot,
} from "@bcr/market-data/debt";
import { debtTrendEnd, debtVisibleObservations, type DebtViewState } from "./state";

export function debtTableSeries(snapshot: DebtSnapshot, state: DebtViewState) {
  const end = debtTrendEnd(snapshot, state);
  return state.countries.flatMap((country) => {
    const series = getDebtSeries(snapshot, country, state.metric);
    return series
      ? [{ series, observations: debtVisibleObservations(series, end, state.window) }]
      : [];
  });
}
export function debtCsv(snapshot: DebtSnapshot, state: DebtViewState) {
  const rows: (string | number | null)[][] = [
    [
      "country",
      "country_name",
      "indicator",
      "indicator_name",
      "period",
      "value",
      "unit",
      "currency",
      "frequency",
      "seasonal_adjustment",
      "valuation",
      "status",
      "source",
      "series_code",
      "source_url",
      "license_url",
      "fetched_at",
      "source_updated_at",
      "note",
    ],
  ];
  for (const { series, observations } of debtTableSeries(snapshot, state))
    for (const point of observations)
      rows.push([
        series.country,
        DEBT_COUNTRIES.find((item) => item.id === series.country)?.name ?? series.country,
        series.indicator,
        DEBT_INDICATORS.find((item) => item.id === series.indicator)?.name ?? series.indicator,
        point.period,
        point.value,
        series.unit,
        series.currency,
        series.frequency,
        series.seasonalAdjustment,
        series.valuation,
        point.status ?? "",
        series.source.name,
        series.source.seriesCode,
        series.source.url,
        series.source.licenseUrl,
        series.fetchedAt,
        series.sourceUpdatedAt,
        series.note,
      ]);
  return `\uFEFF${rows.map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\r\n")}`;
}
