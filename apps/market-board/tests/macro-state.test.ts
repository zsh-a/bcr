import { describe, expect, it } from "vitest";
import { bundledMacroSnapshot, type MacroSnapshot } from "@bcr/market-data/macro";
import { MACRO_EVENTS } from "@bcr/market-data/macro/events";
import { manifest } from "../src/app-manifest";
import {
  eventDateLabel,
  eventFocusRange,
  macroCsv,
  macroStateUrl,
  parseMacroState,
} from "../src/macro/state";

const parse = (search: string) => parseMacroState(search, bundledMacroSnapshot.countries);
describe("macro view deep links and exports", () => {
  it("keeps year parameters numeric in embedded host navigation", () => {
    expect(
      manifest.validateSearch({ view: "macro", from: "1990", to: 2024, year: "2008" }),
    ).toMatchObject({ view: "macro", from: 1990, to: 2024, year: 2008 });
    expect(manifest.validateSearch({ from: "1990x", to: Infinity, year: {} })).toMatchObject({
      from: undefined,
      to: undefined,
      year: undefined,
    });
  });
  it("normalizes external country selections, indicators and degenerate year windows", () => {
    const state = parse("?countries=USA,USA,xxx&indicator=unknown&from=9999&to=1800&event=unknown");
    expect(state.countries).toEqual(["USA"]);
    expect(state.indicator).toBe("growth");
    expect(state.range).toEqual([1980, 1981]);
    expect(state.event).toBeNull();
    expect(parse("?countries=UNKNOWN").countries).toEqual(["CHN"]);
    expect(parse("?countries=CHN,USA,JPN,DEU,GBR,IND,BRA").countries).toHaveLength(6);
  });
  it("clamps the phase year to the visible range for deep links and range changes", () => {
    expect(parse("?mode=phase&from=1990&to=2000&year=2024").year).toBe(2000);
    expect(parse("?mode=phase&from=2010&to=2020&year=1980").year).toBe(2010);
    expect(parse("?mode=phase&from=1990&to=2000").year).toBe(2000);
  });
  it("round trips a shareable selection and its historical context", () => {
    const state = {
      ...parse("?countries=USA,JPN&from=1990&to=2024"),
      mode: "phase" as const,
      year: 2008,
      category: "crisis" as const,
      event: "lehman-2008",
    };
    expect(parse(new URL(macroStateUrl(state), "https://example.test").search)).toEqual(state);
  });
  it("preserves a source's date precision and includes the complete event interval", () => {
    const monthEvent = MACRO_EVENTS.find((event) => event.id === "us-recession-1981")!;
    expect(eventDateLabel(monthEvent)).toBe("1981.07 — 1982.11");
    expect(eventFocusRange(monthEvent)).toEqual([1980, 1985]);
    expect(eventDateLabel(MACRO_EVENTS.find((event) => event.id === "china-fx-reform-1994")!)).toBe(
      "1994",
    );
  });
  it("exports raw zeros and null gaps with per-series provenance after a partial refresh", () => {
    const snapshot: MacroSnapshot = {
      version: 1,
      fetchedAt: "2026-10-25T00:00:00Z",
      sourceUpdatedAt: "2026-10-24",
      countries: [
        {
          id: "USA",
          iso2: "US",
          name: 'United "States"',
          englishName: "United States",
          region: "North America",
        },
      ],
      series: [
        {
          country: "USA",
          indicator: "growth",
          fetchedAt: "2026-09-01T00:00:00Z",
          sourceUpdatedAt: "2026-08-31",
          observations: [
            { year: 2022, value: 0 },
            { year: 2023, value: null },
            { year: 2024, value: 2.123456789 },
          ],
        },
      ],
    };
    const csv = macroCsv(snapshot, {
      ...parse("?countries=USA&from=2022&to=2023"),
      indicator: "growth",
    });
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv.split("\r\n")).toHaveLength(3);
    expect(csv).toContain('"United ""States"""');
    expect(csv).toContain('"2022","0"');
    expect(csv).toContain('"2023",""');
    expect(csv).toContain('"2026-08-31","2026-09-01T00:00:00Z"');
    expect(csv).not.toContain('"2024"');
  });
});
