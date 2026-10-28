import { describe, expect, it } from "vitest";
import {
  bundledCycleSnapshot,
  cycleDisplayObservations,
  getCycleSeries,
  type CycleSnapshot,
} from "@bcr/market-data/cycle";
import { parseCycleState, cycleViewUrl, cycleWindowPeriods } from "../src/cycle/state";
import { cycleCsv } from "../src/cycle/CycleData";
import { manifest } from "../src/app-manifest";

describe("cycle navigation and truthful exports", () => {
  it("restores monthly research links through the host router without numeric-string quoting", () => {
    const query = {
      view: "macro",
      layer: "cycle",
      countries: "USA,JPN",
      period: "2025-07",
      cycleMetric: "coreInflation",
      cycleMode: "3d",
      cycleWindow: "10y",
      cycleFocus: "JPN",
    };
    const validated = manifest.validateSearch(query);
    const state = parseCycleState(
      new URLSearchParams(
        Object.entries(validated).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      ).toString(),
      bundledCycleSnapshot,
    );
    expect(state).toEqual({
      countries: ["USA", "JPN"],
      period: "2025-07",
      metric: "coreInflation",
      asOf: "period",
      mode: "3d",
      window: "10y",
      focus: "JPN",
    });
    expect(
      parseCycleState(
        new URL(cycleViewUrl(state), "https://example.test").search,
        bundledCycleSnapshot,
      ),
    ).toEqual(state);
    expect(
      manifest.validateSearch({ period: "2026-13", cycleFocus: "<x>", cycleMode: "anything" }),
    ).toMatchObject({ period: undefined, cycleFocus: undefined, cycleMode: undefined });
  });
  it("keeps unsupported countries explicit and clamps a month outside the selected window", () => {
    expect(parseCycleState("?countries=IND", bundledCycleSnapshot).countries).toEqual([]);
    const state = parseCycleState(
      "?countries=USA,USA,IND&cycleFocus=IND&period=1990-01&cycleMetric=bad",
      bundledCycleSnapshot,
    );
    expect(state.countries).toEqual(["USA"]);
    expect(state.focus).toBe("USA");
    expect(state.metric).toBe("cli");
    expect(state.period).toBe(cycleWindowPeriods(bundledCycleSnapshot, ["USA"], "5y").at(-1));
    expect(cycleWindowPeriods(bundledCycleSnapshot, ["USA"], "5y")).toHaveLength(60);
    expect(cycleWindowPeriods(bundledCycleSnapshot, ["USA"], "10y")).toHaveLength(120);
  });
  it("retains OECD GDP year-on-year alongside an explicitly separate US SAAR series", () => {
    expect(getCycleSeries(bundledCycleSnapshot, "USA", "gdpGrowth")?.source.name).toContain("OECD");
    expect(getCycleSeries(bundledCycleSnapshot, "USA", "gdpQuarterlyAnnualized")?.note).toContain(
      "SAAR",
    );
    expect(
      bundledCycleSnapshot.series.filter((series) => series.indicator === "gdpGrowth"),
    ).toHaveLength(5);
  });
  it("exports displayed year-on-year and original levels with exact provenance, zeros and holes", () => {
    const source = getCycleSeries(bundledCycleSnapshot, "USA", "industrialProduction")!;
    const series = {
      ...source,
      observations: [
        { period: "2023-01", value: 100 },
        { period: "2023-02", value: 100 },
        { period: "2024-01", value: 100 },
        { period: "2024-02", value: null },
      ],
    };
    const snapshot: CycleSnapshot = { version: 1, fetchedAt: source.fetchedAt, series: [series] };
    const state = {
      ...parseCycleState("?countries=USA", bundledCycleSnapshot),
      metric: "industrialProduction" as const,
      period: "2024-02",
    };
    const csv = cycleCsv(snapshot, state);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"2024-01","0","percent","100","index"');
    expect(csv).toContain('"2024-02","","percent","","index"');
    expect(csv).toContain(source.source.url);
    expect(csv).toContain(source.fetchedAt);
    expect(cycleDisplayObservations(series).at(-1)?.value).toBeNull();
  });
  it("exports weekly dates without making them month-end observations", () => {
    const state = {
      ...parseCycleState("?countries=USA&cycleMetric=initialClaims", bundledCycleSnapshot),
      period: "2026-09",
    };
    const csv = cycleCsv(bundledCycleSnapshot, state);
    expect(csv).toMatch(/"2026-09-\d{2}","\d+","persons"/u);
    expect(csv).not.toContain('"2026-10-17"');
  });
});
