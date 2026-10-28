import {
  CYCLE_COUNTRIES,
  CYCLE_INDICATORS,
  cyclePeriods,
  observationMonth,
  getCycleSeries,
  type CycleIndicatorId,
  type CycleSnapshot,
} from "@bcr/market-data/cycle";
import {
  legacyCountries,
  legacyPeriodDate,
  syncResearchFromLegacy,
} from "../research/legacy-state";

export interface CycleViewState {
  countries: string[];
  period: string;
  metric: CycleIndicatorId;
  mode: "2d" | "3d";
  window: "5y" | "10y" | "all";
  focus: string | null;
  asOf: "period" | "latest";
}
export function cycleWindowPeriods(
  snapshot: CycleSnapshot,
  countries: string[],
  window: CycleViewState["window"],
) {
  const periods = cyclePeriods(snapshot, countries);
  return window === "all" ? periods : periods.slice(window === "10y" ? -120 : -60);
}
export function parseCycleState(search: string, snapshot: CycleSnapshot): CycleViewState {
  const params = new URLSearchParams(search),
    supported = new Set(CYCLE_COUNTRIES.map((country) => country.id));
  const countries = [...new Set((params.get("countries") ?? "CHN,USA,JPN,DEU").split(","))]
    .filter((id) => supported.has(id))
    .slice(0, 6);
  const window =
    params.get("cycleWindow") === "10y"
      ? "10y"
      : params.get("cycleWindow") === "all"
        ? "all"
        : "5y";
  const periods = cycleWindowPeriods(snapshot, countries, window),
    requested = params.get("period");
  const metric =
    CYCLE_INDICATORS.find((item) => item.id === params.get("cycleMetric"))?.id ?? "cli";
  return {
    countries,
    period: requested && periods.includes(requested) ? requested : (periods.at(-1) ?? "2026-09"),
    metric,
    asOf: params.get("cycleAsOf") === "latest" ? "latest" : "period",
    mode: params.get("cycleMode") === "3d" ? "3d" : "2d",
    window,
    focus: countries.includes(params.get("cycleFocus") ?? "")
      ? params.get("cycleFocus")
      : (countries[0] ?? null),
  };
}
export function cycleViewUrl(state: CycleViewState, baseSearch = "") {
  const previous = new URLSearchParams(baseSearch),
    params = new URLSearchParams(previous);
  for (const key of ["cycleAsOf", "cycleMode", "cycleFocus"]) params.delete(key);
  params.set("view", "macro");
  params.set("layer", "cycle");
  params.set(
    "countries",
    legacyCountries(
      state.countries,
      baseSearch,
      CYCLE_COUNTRIES.map((country) => country.id),
    ).join(","),
  );
  params.set("period", state.period);
  params.set("cycleMetric", state.metric);
  params.set("cycleWindow", state.window);
  if (state.asOf === "latest") params.set("cycleAsOf", "latest");
  if (state.mode === "3d") params.set("cycleMode", "3d");
  if (state.focus) params.set("cycleFocus", state.focus);
  syncResearchFromLegacy(params, previous, "cycle", {
    date: legacyPeriodDate(state.period) ?? `${state.period}-01`,
    asOf: state.asOf === "latest" ? "latest" : "date",
    focus: state.focus,
    window: state.window,
    supported: CYCLE_COUNTRIES.map((country) => country.id),
  });
  return `/markets?${params}`;
}

/** Explicit trend cutoff; the CLI phase observation month remains independent. */
export function cycleTrendEnd(snapshot: CycleSnapshot, state: CycleViewState): string {
  if (state.asOf === "period") return state.period;
  return (
    state.countries
      .map(
        (country) => getCycleSeries(snapshot, country, state.metric)?.observations.at(-1)?.period,
      )
      .filter((period): period is string => period !== undefined)
      .map(observationMonth)
      .sort()
      .at(-1) ?? state.period
  );
}
