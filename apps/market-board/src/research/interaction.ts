import {
  formatEconomicValue,
  type EconomicPoint,
  type EconomicTrack,
} from "@bcr/market-data/economy";
import type { MacroEvent } from "@bcr/market-data/macro/events";

const DAY = 86_400_000;
export const FREQUENCY_LABELS = { A: "年度", Q: "季度", M: "月度", W: "周度", D: "日度" };

/** All coordinates are UTC reference-period dates, never release dates. */
export function dateNumber(date: string): number {
  return Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
}
export function isoDate(time: number): string {
  return new Date(Math.floor(time / DAY) * DAY).toISOString().slice(0, 10);
}
export function nativePoint(points: readonly EconomicPoint[], date: string): EconomicPoint | null {
  let low = 0,
    high = points.length - 1,
    found: EconomicPoint | null = null;
  while (low <= high) {
    const middle = (low + high) >>> 1,
      point = points[middle]!;
    if (point.date <= date) {
      found = point;
      low = middle + 1;
    } else high = middle - 1;
  }
  return found;
}
export function referenceDates(tracks: EconomicTrack[], range: [string, string]): string[] {
  return [...new Set(tracks.flatMap((track) => track.points.map((point) => point.date)))]
    .filter((date) => date >= range[0] && date <= range[1] && Number.isFinite(dateNumber(date)))
    .sort((first, second) => first.localeCompare(second));
}
export function moveReference(
  dates: string[],
  cursor: string | null,
  key: string,
): string | null | undefined {
  if (key === "Escape") return null;
  if (!dates.length) return undefined;
  if (key === "Home") return dates[0];
  if (key === "End") return dates.at(-1);
  if (key === "ArrowLeft")
    return cursor ? (dates.findLast((date) => date < cursor) ?? dates[0]) : dates.at(-1);
  if (key === "ArrowRight")
    return cursor ? (dates.find((date) => date > cursor) ?? dates.at(-1)) : dates[0];
  return undefined;
}
export function chartDomain(tracks: EconomicTrack[], range: [string, string]): [number, number] {
  let first = dateNumber(range[0]),
    last = dateNumber(range[1]);
  for (const track of tracks)
    for (const point of track.series.observations) {
      const time = dateNumber(point.date);
      if (!Number.isFinite(time)) continue;
      first = Math.min(first, time);
      last = Math.max(last, time);
    }
  return [first, Math.max(first + DAY, last)];
}
export function formatResearchValue(
  value: number | null | undefined,
  unit = "",
  currency: string | null = null,
): string {
  return formatEconomicValue(value ?? null, unit || "index", currency);
}
export function axisValue(value: number): string {
  const absolute = Math.abs(value);
  return absolute >= 1e12
    ? `${formatResearchValue(value / 1e12)}万亿`
    : absolute >= 1e8
      ? `${formatResearchValue(value / 1e8)}亿`
      : absolute >= 1e4
        ? `${formatResearchValue(value / 1e4)}万`
        : formatResearchValue(value);
}
function boundary(date: string, end: boolean): number {
  const year = Number(date.slice(0, 4)),
    month = Number(date.slice(5, 7));
  if (date.length === 4) return Date.UTC(year + Number(end), 0, 1) - Number(end);
  if (date.length === 7) return Date.UTC(year, month - Number(!end), 1) - Number(end);
  return dateNumber(date) + (end ? DAY - 1 : 0);
}
/** A year/month event occupies its whole source period; no invented exact date. */
export function eventBounds(event: MacroEvent): [number, number] {
  return [boundary(event.start, false), boundary(event.end ?? event.start, true)];
}
export function eventPeriod(event: MacroEvent): string {
  const precision = { day: "日", month: "月", year: "年" }[event.precision];
  return `${event.start}${event.end ? ` — ${event.end}` : ""}（${precision}精度）`;
}
export function visibleEvents(
  events: MacroEvent[] = [],
  selected: MacroEvent | undefined,
  range: [string, string],
): MacroEvent[] {
  const all = new Map(events.map((event) => [event.id, event]));
  if (selected) all.set(selected.id, selected);
  return [...all.values()].filter((event) => {
    const [start, end] = eventBounds(event);
    return start <= dateNumber(range[1]) + DAY - 1 && end >= dateNumber(range[0]);
  });
}
