import { describe, expect, it } from "vitest";
import type { MacroSnapshot } from "@bcr/market-data/macro";
import { MACRO_EVENTS } from "@bcr/market-data/macro/events";
import { groupChartEvents, phaseBounds } from "../src/macro/chartData";
import { createMacroChartOption } from "../src/macro/chartOptions";
import type { MacroViewState } from "../src/macro/state";

const state: MacroViewState = {
  countries: ["USA"],
  indicator: "growth",
  range: [2020, 2025],
  mode: "trend",
  year: 2024,
  event: null,
  category: "all",
};
const snapshot: MacroSnapshot = {
  version: 1,
  fetchedAt: "2026-10-25T00:00:00Z",
  sourceUpdatedAt: "2026-10-08",
  countries: [
    { id: "USA", iso2: "US", name: "美国", englishName: "United States", region: "North America" },
  ],
  series: [
    {
      country: "USA",
      indicator: "growth",
      observations: [
        { year: 2020, value: -2 },
        { year: 2021, value: 1 },
        { year: 2022, value: null },
        { year: 2023, value: 2 },
        { year: 2024, value: 3 },
        { year: 2025, value: null },
      ],
    },
    {
      country: "USA",
      indicator: "inflation",
      observations: [
        { year: 2020, value: -1 },
        { year: 2021, value: 4 },
        { year: 2022, value: 50 },
        { year: 2023, value: 3 },
        { year: 2024, value: 2 },
      ],
    },
  ],
};
const palette = {
  text: "#ececf0",
  muted: "#a0a3ae",
  border: "#3c3e46",
  surface: "#1c1d21",
  colors: ["#79cdbf"],
};
type TestSeries = {
  id: string;
  data: { value?: number[] }[] | number[][];
  itemStyle?: { color?: string };
};
describe("macro chart presentation semantics", () => {
  it("groups overlapping events without dropping their identities or source dates", () => {
    const events = MACRO_EVENTS.filter(
      (event) => event.start.startsWith("2024") && event.category === "policy",
    );
    expect(events.length).toBeGreaterThan(1);
    const groups = groupChartEvents(events, 2019);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.events.map((event) => event.id)).toEqual(events.map((event) => event.id));
    expect(groups[0]?.year).toBe(2024);
    expect(groups[0]?.events[0]?.start).toBe(events[0]?.start);
  });
  it("keeps ending-year and already-started interval events in the annual track", () => {
    const event = MACRO_EVENTS.find((item) => item.id === "us-recession-1981")!;
    expect(groupChartEvents([event], 1982)[0]?.year).toBe(1982);
    expect(event.start).toBe("1981-07");
    expect(
      groupChartEvents([MACRO_EVENTS.find((item) => item.id === "covid-pandemic-2020")!], 2019)[0]
        ?.year,
    ).toBe(2020);
  });
  it("uses stable phase bounds across playback and retains historical extremes", () => {
    const first = phaseBounds(snapshot, { ...state, year: 2020 });
    const second = phaseBounds(snapshot, { ...state, year: 2024 });
    expect(first).toEqual(second);
    expect(first.x[0]).toBeLessThan(-2);
    expect(first.x[1]).toBeGreaterThan(3);
    expect(first.y[1]).toBeGreaterThan(50);
  });
  it("does not connect gaps in phase trails or size missing GDP as a small economy", () => {
    const option = createMacroChartOption(snapshot, { ...state, mode: "phase" }, [], palette, true);
    const series = option.series as TestSeries[];
    expect(series.filter((item) => item.id.startsWith("trail:")).map((item) => item.id)).toEqual([
      "trail:USA:2020",
      "trail:USA:2023",
    ]);
    expect(series.find((item) => item.id === "USA")?.itemStyle?.color).toBe(palette.surface);
  });
  it("labels the last valid visible observation with its actual year", () => {
    const option = createMacroChartOption(snapshot, state, [], palette, true);
    expect(
      (option.series as TestSeries[]).find((item) => item.id === "endpoint:USA")?.data,
    ).toEqual([[2024, 3]]);
    const empty = createMacroChartOption(
      snapshot,
      { ...state, range: [2025, 2025] },
      [],
      palette,
      true,
    );
    expect(
      (empty.series as TestSeries[]).find((item) => item.id === "endpoint:USA"),
    ).toBeUndefined();
  });
});
