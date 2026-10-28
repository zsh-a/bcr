export type EconomicDomain = "annual" | "cycle" | "debt";
export type EconomicFrequency = "A" | "Q" | "M" | "W" | "D";
export type EconomicTheme = "growth" | "prices" | "credit" | "labor" | "confidence";
export interface EconomicCountry {
  id: string;
  iso2: string;
  name: string;
  englishName: string;
  region: string;
}
export interface EconomicMetric {
  id: string;
  domain: EconomicDomain;
  name: string;
  description: string;
  theme: EconomicTheme;
  countries: string[];
  baseline: number | null;
}
export interface EconomicPoint {
  period: string;
  /** End of the native reference period, UTC calendar date; never a release date. */
  date: string;
  value: number | null;
  rawValue: number | null;
  status?: string;
}
export interface EconomicSeries {
  id: string;
  metricId: string;
  country: string;
  frequency: EconomicFrequency;
  unit: string;
  rawUnit: string;
  currency: string | null;
  seasonalAdjustment: "SA" | "NSA" | "notApplicable";
  valuation: string | null;
  source: { name: string; url: string; seriesCode: string; licenseUrl?: string };
  fetchedAt: string;
  sourceUpdatedAt: string | null;
  note: string;
  computed: boolean;
  observations: EconomicPoint[];
}
export interface EconomicReading extends EconomicPoint {
  change: number | null;
  previousPeriod: string | null;
  ageMonths: number;
}
export interface EconomicTrack {
  series: EconomicSeries;
  /** Native source periods only, shared by table and CSV. */
  points: EconomicPoint[];
  /** Chart-only empty calendar positions break omitted M/Q/A periods. */
  plot: EconomicPoint[];
  reading: EconomicReading | null;
  coverage: { valid: number; reported: number; expected: number | null };
}
export interface EconomicRepository {
  countries: EconomicCountry[];
  metrics: EconomicMetric[];
  series: EconomicSeries[];
  fetchedAt: string;
  minDate: string;
  maxDate: string;
  getSeries: (country: string, metricId: string) => EconomicSeries | undefined;
}
export interface EconomicQuery {
  metricId: string;
  countries: string[];
  range: [string, string];
  cutoff: string;
}
