import {
  DEBT_COUNTRIES,
  DEBT_INDICATORS,
  debtQuarters,
  debtPeriodMonth,
  debtMonthIndex,
  debtLatest,
  getDebtSeries,
  type DebtIndicatorId,
  type DebtSeries,
  type DebtSnapshot,
} from "@bcr/market-data/debt";
import {
  legacyCountries,
  legacyPeriodDate,
  syncResearchFromLegacy,
} from "../research/legacy-state";

export interface DebtViewState {
  countries: string[];
  quarter: string;
  metric: DebtIndicatorId;
  focus: string | null;
  mode: "structure" | "phase";
  window: "5y" | "10y" | "all";
  asOf: "latest" | "quarter";
}
export function debtWindowQuarters(
  snapshot: DebtSnapshot,
  countries: string[],
  window: DebtViewState["window"],
) {
  const periods = debtQuarters(snapshot, countries);
  return window === "all" ? periods : periods.slice(window === "5y" ? -20 : -40);
}
export function parseDebtState(search: string, snapshot: DebtSnapshot): DebtViewState {
  const params = new URLSearchParams(search),
    allowed = new Set(DEBT_COUNTRIES.map((country) => country.id));
  const countries = [...new Set((params.get("countries") ?? "CHN,USA,JPN,DEU").split(","))].filter(
    (country) => allowed.has(country),
  );
  const window =
    params.get("debtWindow") === "5y" ? "5y" : params.get("debtWindow") === "all" ? "all" : "10y";
  const quarters = debtWindowQuarters(snapshot, countries, window),
    requested = params.get("debtQuarter");
  return {
    countries,
    quarter: requested && quarters.includes(requested) ? requested : (quarters.at(-1) ?? "2026-Q1"),
    metric:
      DEBT_INDICATORS.find((item) => item.id === params.get("debtMetric"))?.id ?? "privateDebt",
    focus: countries.includes(params.get("debtFocus") ?? "")
      ? params.get("debtFocus")
      : (countries[0] ?? null),
    mode: params.get("debtMode") === "phase" ? "phase" : "structure",
    window,
    asOf: params.get("debtAsOf") === "quarter" ? "quarter" : "latest",
  };
}
export function debtStateUrl(state: DebtViewState, baseSearch = "") {
  const previous = new URLSearchParams(baseSearch),
    params = new URLSearchParams(previous);
  params.set("view", "macro");
  params.set("layer", "debt");
  params.set(
    "countries",
    legacyCountries(
      state.countries,
      baseSearch,
      DEBT_COUNTRIES.map((country) => country.id),
    ).join(","),
  );
  params.set("debtQuarter", state.quarter);
  params.set("debtMetric", state.metric);
  params.set("debtFocus", state.focus ?? "");
  params.set("debtMode", state.mode);
  params.set("debtWindow", state.window);
  params.set("debtAsOf", state.asOf);
  syncResearchFromLegacy(params, previous, "debt", {
    date: legacyPeriodDate(state.quarter) ?? "0001-01-01",
    asOf: state.asOf === "latest" ? "latest" : "date",
    focus: state.focus,
    window: state.window,
    supported: DEBT_COUNTRIES.map((country) => country.id),
  });
  return `/markets?${params}`;
}
/** Quarter comparisons and latest source trends are separate, explicitly labelled cutoffs. */
export function debtTrendEnd(snapshot: DebtSnapshot, state: DebtViewState) {
  if (state.asOf === "quarter") return debtPeriodMonth(state.quarter);
  return (
    state.countries
      .map((country) => debtLatest(getDebtSeries(snapshot, country, state.metric))?.period)
      .filter((period): period is string => period !== undefined)
      .map(debtPeriodMonth)
      .sort()
      .at(-1) ?? debtPeriodMonth(state.quarter)
  );
}
export function debtVisibleObservations(
  series: DebtSeries,
  end: string,
  window: DebtViewState["window"],
) {
  const last = debtMonthIndex(end),
    months = window === "5y" ? 60 : 120;
  return series.observations.filter(
    (point) =>
      debtPeriodMonth(point.period) <= end &&
      (window === "all" || debtMonthIndex(point.period) >= last - months + 1),
  );
}
export const debtStatusLabel = (status?: string) =>
  status?.startsWith("derived")
    ? "本币余额同比计算值"
    : status === "A"
      ? ""
      : status === "forecast"
        ? "预测"
        : status === "estimate" || status === "E"
          ? "估计"
          : status === "P" || status === "provisional"
            ? "暂定"
            : status === "actual"
              ? "实际"
              : status
                ? `来源标记 ${status}`
                : "";

export function debtReadingIsOld(series: DebtSeries, period: string, reference: string) {
  return (
    debtMonthIndex(reference) - debtMonthIndex(period) >
    (series.frequency === "A" ? 24 : series.frequency === "Q" ? 9 : 2)
  );
}
