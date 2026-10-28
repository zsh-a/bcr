import {
  economicPeriodEnd,
  formatEconomicValue,
  type EconomicPoint,
  type EconomicTrack,
} from "@bcr/market-data/economy";
import type { MacroEvent } from "@bcr/market-data/macro/events";

export const FREQUENCY_NAMES = { A: "年度", Q: "季度", M: "月度", W: "周度", D: "日度" };
export const ADJUSTMENT_NAMES = { SA: "季调", NSA: "未季调", notApplicable: "未单列季调标记" };
const countryOrder = ["CHN", "USA", "JPN", "DEU", "GBR", "IND", "FRA", "BRA", "CAN", "KOR"];
export function countryColorSlot(country: string, count = 6) {
  const known = countryOrder.indexOf(country);
  return (
    (known < 0
      ? country.split("").reduce((sum, char) => sum * 31 + char.charCodeAt(0), 0)
      : known) % count
  );
}
export function trackReading(track: EconomicTrack, cursor: string | null): EconomicPoint | null {
  if (!cursor) return track.reading;
  return [...track.points].reverse().find((point) => point.date <= cursor) ?? null;
}
export function pointLabel(track: EconomicTrack, cursor: string | null) {
  const point = trackReading(track, cursor);
  return formatEconomicValue(point?.value ?? null, track.series.unit, track.series.currency);
}
export function eventBounds(event: MacroEvent): [string, string] {
  const start =
    event.start.length === 4
      ? `${event.start}-01-01`
      : event.start.length === 7
        ? `${event.start}-01`
        : event.start;
  const end = event.end ?? event.start;
  return [start, economicPeriodEnd(end, end.length === 4 ? "A" : end.length === 7 ? "M" : "D")];
}
export function eventWindow(event: MacroEvent, min: string, max: string): [string, string] {
  const [start, end] = eventBounds(event);
  return [
    `${Math.max(Number(min.slice(0, 4)), Number(start.slice(0, 4)) - 2)}-01-01`,
    `${Math.min(Number(max.slice(0, 4)), Number(end.slice(0, 4)) + 2)}-12-31`,
  ].map((date) => (date < min ? min : date > max ? max : date)) as [string, string];
}
export function downloadResearchCsv(csv: string, name: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
