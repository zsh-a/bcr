import { describe, expect, it } from "vitest";
import {
  MACRO_EVENTS,
  MACRO_EVENT_CATALOG_UPDATED_AT,
  filterMacroEvents,
} from "@bcr/market-data/macro/events";
import { selectRailEvents } from "../src/research/event-selection";

describe("event rail coverage and explicit filters", () => {
  it("puts newly sourced events first in the current data window without changing the catalog", () => {
    const before = MACRO_EVENTS.map((event) => event.id);
    const events = selectRailEvents(
      MACRO_EVENTS,
      ["2021-10-01", "2026-10-23"],
      "window",
      MACRO_EVENT_CATALOG_UPDATED_AT,
    );
    expect(events[0]?.id).toBe("pboc-liquidity-framework-2026");
    expect(events.map((event) => event.id)).toContain("iea-oil-release-followup-2026");
    expect(events.map((event) => event.id)).not.toContain("covid-pandemic-2020");
    expect(MACRO_EVENTS.map((event) => event.id)).toEqual(before);
  });
  it("lets users inspect recent events beyond a historical chart window, keeping countries filtered", () => {
    const scoped = filterMacroEvents(MACRO_EVENTS, ["GBR"], [1980, 2026], "all");
    const events = selectRailEvents(
      scoped,
      ["2008-01-01", "2009-12-31"],
      "recent",
      MACRO_EVENT_CATALOG_UPDATED_AT,
    );
    expect(events.map((event) => event.id)).toContain("boe-cut-2025");
    expect(events.map((event) => event.id)).toContain("middle-east-war-2026");
    expect(events.map((event) => event.id)).not.toContain("pboc-liquidity-framework-2026");
    expect(events.map((event) => event.id)).not.toContain("china-financial-package-2024");
    expect(events.every((event) => event.start >= "2024-10-27")).toBe(true);
  });
  it("does not quietly replace an empty historical window with unrelated recent events", () => {
    expect(
      selectRailEvents(
        MACRO_EVENTS,
        ["1980-01-01", "1980-12-31"],
        "window",
        MACRO_EVENT_CATALOG_UPDATED_AT,
      ),
    ).toEqual([]);
    expect(
      selectRailEvents(
        MACRO_EVENTS,
        ["1980-01-01", "1980-12-31"],
        "all",
        MACRO_EVENT_CATALOG_UPDATED_AT,
      ),
    ).toHaveLength(MACRO_EVENTS.length);
  });
  it("includes an episode overlapping the window even when its start is earlier", () => {
    const events = selectRailEvents(
      MACRO_EVENTS,
      ["2008-06-01", "2008-12-31"],
      "window",
      MACRO_EVENT_CATALOG_UPDATED_AT,
    );
    expect(events.map((event) => event.id)).toContain("us-great-recession");
  });
});
