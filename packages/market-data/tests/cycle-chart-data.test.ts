import { describe, expect, it } from "vitest";
import { cycleChartObservations, type CycleSeries } from "../src/cycle/index";

const base: CycleSeries = {
  country: "USA",
  indicator: "unemployment",
  frequency: "M",
  unit: "percent",
  seasonalAdjustment: "SA",
  source: { name: "Test source", url: "https://example.test/", seriesCode: "TEST" },
  fetchedAt: "2026-10-25T00:00:00Z",
  sourceUpdatedAt: null,
  observations: [],
};
describe("calendar gaps in cycle charts", () => {
  it("breaks monthly lines across an entirely omitted month without changing resource observations", () => {
    const series = {
      ...base,
      observations: [
        { period: "2025-09", value: 4 },
        { period: "2025-11", value: 0 },
      ],
    };
    expect(cycleChartObservations(series)).toEqual([
      { period: "2025-09", value: 4 },
      { period: "2025-10", value: null },
      { period: "2025-11", value: 0 },
    ]);
    expect(series.observations).toHaveLength(2);
  });
  it("breaks quarterly lines across missing quarters and year boundaries", () => {
    expect(
      cycleChartObservations({
        ...base,
        frequency: "Q",
        indicator: "gdpGrowth",
        observations: [
          { period: "2024-Q3", value: 1 },
          { period: "2025-Q2", value: 2 },
        ],
      }),
    ).toEqual([
      { period: "2024-Q3", value: 1 },
      { period: "2024-Q4", value: null },
      { period: "2025-Q1", value: null },
      { period: "2025-Q2", value: 2 },
    ]);
  });
  it("retains weekly and daily native calendars without inventing weekend observations", () => {
    const series: CycleSeries = {
      ...base,
      frequency: "D",
      observations: [
        { period: "2026-10-16", value: 1 },
        { period: "2026-10-19", value: 2 },
      ],
    };
    expect(cycleChartObservations(series)).toBe(series.observations);
  });
});
