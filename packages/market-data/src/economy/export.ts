import type { EconomicTrack } from "./model";

const number = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2, notation: "compact" });
const currencies: Record<string, string> = {
  CNY: "人民币",
  USD: "美元",
  JPY: "日元",
  EUR: "欧元",
  GBP: "英镑",
};
const suffixes: Record<string, string> = {
  index: "",
  percent: "%",
  percentagePoints: " 个百分点",
  percentGdp: "% GDP",
  percentIncome: "% 收入",
  percentRevenue: "% 财政收入",
  persons: " 人",
  thousandPersons: " 千人",
  billionsUsd: " 十亿美元",
  thousandUnits: " 千套",
  hours: " 小时",
  ratio: " 倍",
};
/** Formatting changes no stored units. Local-currency magnitudes always retain the explicit currency. */
export function formatEconomicValue(
  value: number | null | undefined,
  unit: string,
  currency?: string | null,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const numeric = Object.is(value, -0) ? 0 : value;
  if (unit === "usd") return `${compact.format(numeric)} 美元`;
  if (unit === "billionLocal" || unit === "trillionLocal") {
    const label = currency ? (currencies[currency] ?? currency) : "（币种未提供）";
    return `${number.format(numeric)} ${unit === "billionLocal" ? "十亿" : "万亿"}${label}`;
  }
  return `${number.format(numeric)}${suffixes[unit] ?? ` ${unit}`}`;
}
/** Only native observations are exported; chart gap positions are never promoted to source records. */
export function economicCsv(tracks: EconomicTrack[]): string {
  const rows: (string | number | boolean | null | undefined)[][] = [
    [
      "series_id",
      "metric_id",
      "country",
      "period",
      "date",
      "display_value",
      "display_unit",
      "raw_value",
      "raw_unit",
      "frequency",
      "seasonal_adjustment",
      "currency",
      "valuation",
      "status",
      "computed",
      "source",
      "series_code",
      "source_url",
      "source_updated_at",
      "fetched_at",
      "license_url",
      "note",
    ],
  ];
  for (const { series, points } of tracks)
    for (const point of points)
      rows.push([
        series.id,
        series.metricId,
        series.country,
        point.period,
        point.date,
        point.value,
        series.unit,
        point.rawValue,
        series.rawUnit,
        series.frequency,
        series.seasonalAdjustment,
        series.currency,
        series.valuation,
        point.status,
        series.computed,
        series.source.name,
        series.source.seriesCode,
        series.source.url,
        series.sourceUpdatedAt,
        series.fetchedAt,
        series.source.licenseUrl,
        series.note,
      ]);
  return `\uFEFF${rows.map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\r\n")}`;
}
