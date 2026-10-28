import type { MacroEvent } from "@bcr/market-data/macro/events";
import { eventBounds } from "./presentation";

export type EventRailScope = "window" | "recent" | "all";
/** The scope applies after country filtering; it never silently widens the country selection. */
export function selectRailEvents(
  events: readonly MacroEvent[],
  range: [string, string],
  scope: EventRailScope,
  catalogDate: string,
): MacroEvent[] {
  const reference = new Date(`${catalogDate}T00:00:00Z`);
  reference.setUTCFullYear(reference.getUTCFullYear() - 2);
  const recentStart = reference.toISOString().slice(0, 10);
  return events
    .filter((event) => {
      const [start, end] = eventBounds(event);
      return (
        scope === "all" ||
        (scope === "recent"
          ? start <= catalogDate && end >= recentStart
          : start <= range[1] && end >= range[0])
      );
    })
    .toSorted(
      (first, second) =>
        second.start.localeCompare(first.start) || first.id.localeCompare(second.id),
    );
}
