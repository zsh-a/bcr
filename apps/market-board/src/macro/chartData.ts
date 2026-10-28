import { getMacroSeries, type MacroSnapshot } from "@bcr/market-data/macro";
import { MACRO_EVENT_CATEGORIES, type MacroEvent } from "@bcr/market-data/macro/events";
import type { MacroViewState } from "./state";

export const EVENT_LANE_NAMES = ["危机", "政策", "地缘", "卫生", "贸易"];
export interface EventGroup {
  year: number;
  lane: number;
  events: MacroEvent[];
}
export function groupChartEvents(events: readonly MacroEvent[], from: number): EventGroup[] {
  const groups = new Map<string, EventGroup>();
  for (const event of events) {
    const year = Math.max(from, Number(event.start.slice(0, 4)));
    const lane = MACRO_EVENT_CATEGORIES.findIndex((category) => category.id === event.category);
    const key = `${year}:${lane}`;
    const group = groups.get(key) ?? { year, lane, events: [] };
    group.events.push(event);
    groups.set(key, group);
  }
  return [...groups.values()];
}
export function phaseObservation(
  snapshot: MacroSnapshot,
  country: string,
  indicator: "growth" | "inflation" | "gdp",
  year: number,
) {
  return (
    getMacroSeries(snapshot, country, indicator).find((point) => point.year === year)?.value ?? null
  );
}
/** Playback keeps its frame of reference across all selected years, including drawn trails. */
export function phaseBounds(snapshot: MacroSnapshot, state: MacroViewState) {
  const bounds = (indicator: "growth" | "inflation") => {
    const values = state.countries.flatMap((country) =>
      getMacroSeries(snapshot, country, indicator).flatMap((point) =>
        point.year >= state.range[0] && point.year <= state.range[1] && point.value !== null
          ? [point.value]
          : [],
      ),
    );
    const min = Math.min(0, ...values),
      max = Math.max(0, ...values);
    const padding = Math.max(1, (max - min) * 0.12);
    return [Math.floor(min - padding), Math.ceil(max + padding)] as const;
  };
  return { x: bounds("growth"), y: bounds("inflation") };
}
