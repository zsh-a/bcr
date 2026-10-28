import { MACRO_EVENTS } from "@bcr/market-data/macro/events";
import {
  calendarDate,
  migrateLegacyResearchParams,
  RESEARCH_QUERY_KEYS,
  windowStart,
} from "./legacy-state";

export type ResearchPreset =
  | "overview"
  | "growth"
  | "prices"
  | "credit"
  | "labor"
  | "confidence"
  | "history";
export interface ResearchState {
  countries: string[];
  focus: string | null;
  from: string;
  to: string;
  date: string;
  asOf: "latest" | "date";
  preset: ResearchPreset;
  pins: string[];
  event: string | null;
}
export interface ResearchContext {
  countryIds: string[];
  metricIds: string[];
  minDate: string;
  maxDate: string;
}
const presets: ResearchPreset[] = [
  "overview",
  "growth",
  "prices",
  "credit",
  "labor",
  "confidence",
  "history",
];
const defaults = ["CHN", "USA", "JPN", "DEU"];
const unique = (values: string[]) => [...new Set(values)];
export function parseResearchState(search: string, context: ResearchContext): ResearchState {
  const minimum = calendarDate(context.minDate) ?? "0001-01-01";
  const maximum = calendarDate(context.maxDate) ?? minimum;
  const min = minimum < maximum ? minimum : maximum,
    max = minimum < maximum ? maximum : minimum;
  const clamp = (value: string) => (value < min ? min : value > max ? max : value);
  const params = migrateLegacyResearchParams(search, max);
  const known = new Set(context.countryIds),
    metrics = new Set(context.metricIds);
  const fallback = defaults.filter((id) => known.has(id));
  const requested = params.get("countries");
  const selection = unique((requested ?? defaults.join(",")).split(","))
    .filter((id) => known.has(id))
    .slice(0, 6);
  const countries = selection.length || requested === "" ? selection : fallback;
  const to = clamp(calendarDate(params.get("rTo")) ?? max);
  const date = clamp(calendarDate(params.get("rDate")) ?? max);
  const asOf = params.get("rAsOf") === "date" ? "date" : "latest";
  const end = asOf === "date" && date < to ? date : to;
  const from = [clamp(calendarDate(params.get("rFrom")) ?? windowStart(end, 5)), end].sort()[0]!;
  const focus = params.get("rFocus");
  return {
    countries,
    focus: focus === "" ? null : countries.includes(focus ?? "") ? focus : (countries[0] ?? null),
    from,
    to,
    date: asOf === "date" && date > to ? to : date,
    asOf,
    preset: presets.find((preset) => preset === params.get("rPreset")) ?? "overview",
    pins: unique((params.get("rPins") ?? "").split(","))
      .filter((id) => metrics.has(id))
      .slice(0, 8),
    event: MACRO_EVENTS.some((event) => event.id === params.get("rEvent"))
      ? params.get("rEvent")
      : null,
  };
}
export function researchStateUrl(state: ResearchState, baseSearch = ""): string {
  const params = new URLSearchParams(baseSearch);
  for (const key of RESEARCH_QUERY_KEYS) params.delete(key);
  params.set("view", "macro");
  params.set("layer", "research");
  params.set("countries", state.countries.join(","));
  params.set("rFrom", state.from);
  params.set("rTo", state.to);
  params.set("rDate", state.date);
  params.set("rAsOf", state.asOf);
  params.set("rPreset", state.preset);
  params.set("rFocus", state.focus ?? "");
  params.set("rPins", unique(state.pins).slice(0, 8).join(","));
  if (state.event) params.set("rEvent", state.event);
  return `/markets?${params}`;
}
/** Reference-period cutoff only; source publication dates remain separate metadata. */
export function researchCutoff(state: ResearchState, maxDate: string): string {
  const cutoff = state.asOf === "latest" ? maxDate : state.date;
  return state.to < cutoff ? state.to : cutoff;
}
