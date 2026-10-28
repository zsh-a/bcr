import type { MacroCountry, MacroIndicatorId, MacroSnapshot } from "@bcr/market-data/macro";
import {
  MACRO_EVENT_CATEGORIES,
  MACRO_EVENTS,
  type MacroEvent,
  type MacroEventCategory,
} from "@bcr/market-data/macro/events";
import { syncResearchFromLegacy } from "../research/legacy-state";

export const MIN_YEAR = 1980;
export const MAX_YEAR = 2025;
export const SERIES_TOKENS = [
  "--color-accent",
  "--color-info",
  "--color-amber",
  "--color-danger",
  "--color-success",
  "--color-muted",
] as const;
export interface MacroViewState {
  countries: string[];
  indicator: MacroIndicatorId;
  range: [number, number];
  mode: "trend" | "phase";
  year: number;
  category: MacroEventCategory | "all";
  event: string | null;
}
const indicators: MacroIndicatorId[] = [
  "gdp",
  "growth",
  "inflation",
  "gdpPerCapita",
  "unemployment",
  "trade",
];
const yearValue = (input: string | null, fallback: number) =>
  input && /^\d{4}$/u.test(input)
    ? Math.max(MIN_YEAR, Math.min(MAX_YEAR, Number(input)))
    : fallback;
export function parseMacroState(
  search: string,
  countries: readonly MacroCountry[],
): MacroViewState {
  const params = new URLSearchParams(search);
  const known = new Set(countries.map((country) => country.id));
  const selected = [...new Set((params.get("countries") ?? "CHN,USA,JPN,DEU").split(","))]
    .filter((id) => known.has(id))
    .slice(0, 6);
  const from = yearValue(params.get("from"), 1990),
    to = yearValue(params.get("to"), MAX_YEAR);
  const indicator = params.get("indicator"),
    category = params.get("category"),
    event = params.get("event");
  const range: [number, number] =
    from < to ? [from, to] : [Math.max(MIN_YEAR, to - 1), Math.max(MIN_YEAR + 1, to)];
  return {
    countries: selected.length
      ? selected
      : [countries.find((country) => country.id === "CHN")?.id ?? countries[0]?.id ?? "CHN"],
    indicator: indicators.find((id) => id === indicator) ?? "growth",
    range,
    mode: params.get("mode") === "phase" ? "phase" : "trend",
    year: Math.max(range[0], Math.min(range[1], yearValue(params.get("year"), 2024))),
    category: MACRO_EVENT_CATEGORIES.find((item) => item.id === category)?.id ?? "all",
    event: MACRO_EVENTS.some((item) => item.id === event) ? event : null,
  };
}
export function macroStateUrl(state: MacroViewState, baseSearch = "") {
  const previous = new URLSearchParams(baseSearch),
    params = new URLSearchParams(previous);
  for (const key of ["mode", "year", "category", "event"]) params.delete(key);
  params.set("view", "macro");
  params.set("layer", "history");
  params.set("countries", state.countries.join(","));
  params.set("indicator", state.indicator);
  params.set("from", String(state.range[0]));
  params.set("to", String(state.range[1]));
  if (state.mode === "phase") {
    params.set("mode", "phase");
    params.set("year", String(state.year));
  }
  if (state.category !== "all") params.set("category", state.category);
  if (state.event) params.set("event", state.event);
  syncResearchFromLegacy(params, previous, "history", {
    date: `${state.year}-12-31`,
    asOf: state.mode === "phase" ? "date" : "latest",
    range: state.range,
    event: state.event,
  });
  return `/markets?${params}`;
}
export function eventFocusRange(event: MacroEvent): [number, number] {
  return [
    Math.max(MIN_YEAR, Number(event.start.slice(0, 4)) - 3),
    Math.min(MAX_YEAR, Number((event.end ?? event.start).slice(0, 4)) + 3),
  ];
}
export function eventDateLabel(event: MacroEvent) {
  const format = (date: string) =>
    date
      .slice(0, event.precision === "year" ? 4 : event.precision === "month" ? 7 : 10)
      .replaceAll("-", ".");
  return `${format(event.start)}${event.end ? ` — ${format(event.end)}` : ""}`;
}
export function macroCsv(snapshot: MacroSnapshot, state: MacroViewState) {
  const cells = (values: (string | number | null)[]) =>
    values.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",");
  const names = new Map(snapshot.countries.map((country) => [country.id, country.name]));
  return (
    "\uFEFF" +
    [
      cells(["国家", "ISO3", "指标", "年份", "数值", "来源", "来源更新日期", "抓取时间"]),
      ...snapshot.series
        .filter(
          (series) =>
            state.countries.includes(series.country) && series.indicator === state.indicator,
        )
        .flatMap((series) =>
          series.observations
            .filter((point) => point.year >= state.range[0] && point.year <= state.range[1])
            .map((point) =>
              cells([
                names.get(series.country) ?? series.country,
                series.country,
                series.indicator,
                point.year,
                point.value,
                "World Bank WDI",
                series.sourceUpdatedAt ?? snapshot.sourceUpdatedAt,
                series.fetchedAt ?? snapshot.fetchedAt,
              ]),
            ),
        ),
    ].join("\r\n")
  );
}
