/** Annual World Development Indicators. Percentages are percentage points, not fractions. */
export type MacroIndicatorId =
  | "gdp"
  | "growth"
  | "inflation"
  | "gdpPerCapita"
  | "unemployment"
  | "trade";

export interface MacroCountry {
  id: string;
  iso2: string;
  name: string;
  englishName: string;
  region: string;
}

export interface MacroIndicator {
  id: MacroIndicatorId;
  name: string;
  shortName: string;
  code: string;
  unit: "usd" | "percent";
  description: string;
}

export interface MacroObservation {
  year: number;
  value: number | null;
}

export interface MacroSeries {
  country: string;
  indicator: MacroIndicatorId;
  /** Per-series provenance survives merging a selected-country refresh into a global snapshot. */
  sourceUpdatedAt?: string;
  fetchedAt?: string;
  observations: MacroObservation[];
}

export interface MacroSnapshot {
  version: 1;
  fetchedAt: string;
  sourceUpdatedAt: string;
  countries: MacroCountry[];
  series: MacroSeries[];
}

/** Compact on-disk representation; values retain upstream numeric precision. */
export interface CompactMacroSnapshot {
  version: 1;
  source: "World Bank: World Development Indicators";
  sourceUrl: string;
  license: string;
  fetchedAt: string;
  sourceUpdatedAt: string;
  startYear: number;
  endYear: number;
  countries: [string, string, string, string, string][];
  series: [string, MacroIndicatorId, number, (number | null)[]][];
}
