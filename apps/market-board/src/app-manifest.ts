import { definition } from "./app-definition";
import { Globe2 } from "lucide-react";
import type { AppManifest } from "@bcr/shell-contract";
import { calendarDate } from "./research/legacy-state";

/** Keep numeric query values numeric through the host router's JSON search serialization. */
function macroYear(value: unknown): number | undefined {
  const year = typeof value === "string" && /^\d{4}$/u.test(value) ? Number(value) : value;
  return typeof year === "number" && Number.isInteger(year) && year >= 1980 && year <= 2025
    ? year
    : undefined;
}

/**
 * Market Atlas — multi-market board.
 *
 * Reads live quotes through `@bcr/market-data` and degrades to cached and demo
 * snapshots when the network is unavailable, so it is the one slice that is not
 * purely on-device.
 */
export const manifest = {
  ...definition,
  icon: Globe2,
  load: () => import("./App"),
  validateSearch: (search) => ({
    view:
      typeof search["view"] === "string" &&
      ["overview", "macro", "sectors", "breadth", "watchlist"].includes(search["view"])
        ? search["view"]
        : undefined,
    snapshot:
      typeof search["snapshot"] === "string" && /^[a-f0-9]{64}$/u.test(search["snapshot"])
        ? search["snapshot"]
        : undefined,
    date:
      typeof search["date"] === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(search["date"])
        ? search["date"]
        : undefined,
    instrument: typeof search["instrument"] === "string" ? search["instrument"] : undefined,
    countries:
      typeof search["countries"] === "string" ? search["countries"].slice(0, 23) : undefined,
    indicator:
      typeof search["indicator"] === "string" ? search["indicator"].slice(0, 20) : undefined,
    from: macroYear(search["from"]),
    to: macroYear(search["to"]),
    mode: search["mode"] === "phase" ? "phase" : undefined,
    year: macroYear(search["year"]),
    category: typeof search["category"] === "string" ? search["category"].slice(0, 20) : undefined,
    event: typeof search["event"] === "string" ? search["event"].slice(0, 100) : undefined,
    layer: ["research", "history", "cycle", "debt"].includes(String(search["layer"]))
      ? String(search["layer"])
      : undefined,
    rFrom:
      typeof search["rFrom"] === "string"
        ? (calendarDate(search["rFrom"]) ?? undefined)
        : undefined,
    rTo: typeof search["rTo"] === "string" ? (calendarDate(search["rTo"]) ?? undefined) : undefined,
    rDate:
      typeof search["rDate"] === "string"
        ? (calendarDate(search["rDate"]) ?? undefined)
        : undefined,
    rAsOf: ["latest", "date"].includes(String(search["rAsOf"]))
      ? String(search["rAsOf"])
      : undefined,
    rPreset: ["overview", "growth", "prices", "credit", "labor", "confidence", "history"].includes(
      String(search["rPreset"]),
    )
      ? String(search["rPreset"])
      : undefined,
    rFocus:
      typeof search["rFocus"] === "string" && /^(?:[A-Z]{3})?$/u.test(search["rFocus"])
        ? search["rFocus"]
        : undefined,
    rPins: typeof search["rPins"] === "string" ? search["rPins"].slice(0, 400) : undefined,
    rEvent: typeof search["rEvent"] === "string" ? search["rEvent"].slice(0, 100) : undefined,
    debtQuarter:
      typeof search["debtQuarter"] === "string" && /^\d{4}-Q[1-4]$/u.test(search["debtQuarter"])
        ? search["debtQuarter"]
        : undefined,
    debtMetric:
      typeof search["debtMetric"] === "string" ? search["debtMetric"].slice(0, 40) : undefined,
    debtWindow: ["5y", "10y", "all"].includes(String(search["debtWindow"]))
      ? String(search["debtWindow"])
      : undefined,
    debtFocus:
      typeof search["debtFocus"] === "string" && /^[A-Z]{3}$/u.test(search["debtFocus"])
        ? search["debtFocus"]
        : undefined,
    debtMode: search["debtMode"] === "phase" ? "phase" : undefined,
    debtAsOf:
      search["debtAsOf"] === "quarter"
        ? "quarter"
        : search["debtAsOf"] === "latest"
          ? "latest"
          : undefined,
    period:
      typeof search["period"] === "string" && /^\d{4}-(0[1-9]|1[0-2])$/u.test(search["period"])
        ? search["period"]
        : undefined,
    cycleMetric:
      typeof search["cycleMetric"] === "string" ? search["cycleMetric"].slice(0, 40) : undefined,
    cycleMode: search["cycleMode"] === "3d" ? "3d" : undefined,
    cycleAsOf: search["cycleAsOf"] === "latest" ? "latest" : undefined,
    cycleWindow: ["5y", "10y", "all"].includes(String(search["cycleWindow"]))
      ? String(search["cycleWindow"])
      : undefined,
    cycleFocus:
      typeof search["cycleFocus"] === "string" && /^[A-Z]{3}$/u.test(search["cycleFocus"])
        ? search["cycleFocus"]
        : undefined,
  }),
} as const satisfies AppManifest;
