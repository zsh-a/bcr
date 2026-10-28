import { describe, expect, it } from "vitest";
import type { EconomicPoint, EconomicTrack } from "@bcr/market-data/economy";
import type { MacroEvent } from "@bcr/market-data/macro/events";
import { buildResearchChartOption, countryColor } from "../src/research/chart-options";
import {
  chartDomain,
  dateNumber,
  eventBounds,
  eventPeriod,
  formatResearchValue,
  isoDate,
  moveReference,
  nativePoint,
  referenceDates,
  visibleEvents,
} from "../src/research/interaction";

const point = (period: string, date: string, value: number | null): EconomicPoint => ({
  period,
  date,
  value,
  rawValue: value,
});
const observations = [
  point("2023-Q4", "2023-12-31", -2),
  point("2024-Q1", "2024-03-31", 0),
  point("2024-Q2", "2024-06-30", null),
  point("2024-Q4", "2024-12-31", 3),
];
const track: EconomicTrack = {
  series: {
    id: "USA:metric",
    metricId: "metric",
    country: "USA",
    frequency: "Q",
    unit: "%",
    rawUnit: "%",
    currency: null,
    seasonalAdjustment: "SA",
    valuation: null,
    source: { name: "Test", url: "https://example.com", seriesCode: "GDP" },
    fetchedAt: "2025-01-01",
    sourceUpdatedAt: null,
    note: "",
    computed: false,
    observations,
  },
  points: observations.slice(1),
  plot: [...observations.slice(1, 3), point("2024-Q3", "2024-09-30", null), observations[3]!],
  reading: null,
  coverage: { valid: 2, reported: 3, expected: 4 },
};
const event: MacroEvent = {
  id: "event",
  title: "Year context",
  start: "2024",
  precision: "year",
  category: "policy",
  countries: [],
  summary: "",
  mechanism: "",
  sources: [],
};
const palette = {
  text: "#222222",
  muted: "#777777",
  border: "#dddddd",
  surface: "#fafafa",
  colors: ["#123456", "#789abc"],
};
const props = {
  tracks: [track],
  range: ["2024-01-01", "2024-12-31"] as [string, string],
  baseline: 0,
  cursorDate: null,
  onCursor: () => {},
  colors: { USA: "#aabbcc" },
  label: "Test",
};

describe("research chart native reference dates", () => {
  it("reads only actual source periods at or before the UTC cursor and retains nulls", () => {
    expect(nativePoint(track.points, "2024-03-30")).toBeNull();
    expect(nativePoint(track.points, "2024-04-30")).toMatchObject({ period: "2024-Q1", value: 0 });
    expect(nativePoint(track.points, "2024-11-30")).toMatchObject({
      period: "2024-Q2",
      value: null,
    });
    expect(nativePoint(track.points, "2024-12-31")).toMatchObject({ period: "2024-Q4", value: 3 });
    expect(isoDate(dateNumber("2024-03-31"))).toBe("2024-03-31");
  });
  it("moves the shared cursor over the native dates union, excluding chart-only gaps", () => {
    const annual = { ...track, points: [point("2024", "2024-12-31", 1)] };
    const dates = referenceDates([track, annual], props.range);
    expect(dates).toEqual(["2024-03-31", "2024-06-30", "2024-12-31"]);
    expect(moveReference(dates, "2024-05-15", "ArrowLeft")).toBe("2024-03-31");
    expect(moveReference(dates, "2024-05-15", "ArrowRight")).toBe("2024-06-30");
    expect(moveReference(dates, null, "Home")).toBe("2024-03-31");
    expect(moveReference(dates, null, "End")).toBe("2024-12-31");
    expect(moveReference(dates, dates[0]!, "Escape")).toBeNull();
    expect(moveReference(dates, null, "Tab")).toBeUndefined();
  });
  it("formats zero, negative values and missing observations without coercion", () => {
    expect(formatResearchValue(0, "percent")).toBe("0%");
    expect(formatResearchValue(-2, "percentagePoints")).toBe("-2 个百分点");
    expect(formatResearchValue(null, "%")).toBe("—");
    expect(formatResearchValue(NaN, "%")).toBe("—");
  });
  it("preserves source event precision as complete calendar bands", () => {
    const [first, last] = eventBounds(event);
    expect(isoDate(first)).toBe("2024-01-01");
    expect(isoDate(last)).toBe("2024-12-31");
    expect(eventPeriod(event)).toBe("2024（年精度）");
    expect(eventBounds({ ...event, start: "2024-02", precision: "month" })).toEqual([
      dateNumber("2024-02-01"),
      dateNumber("2024-03-01") - 1,
    ]);
    expect(visibleEvents([], event, ["2024-07-01", "2024-08-31"])).toEqual([event]);
  });
  it("uses a shared real calendar domain and stable country colours", () => {
    expect(chartDomain([track], props.range)).toEqual([
      dateNumber("2023-12-31"),
      dateNumber("2024-12-31"),
    ]);
    expect(countryColor("USA", props.colors, palette)).toBe("#aabbcc");
    expect(countryColor("DEU", {}, palette)).toBe(countryColor("DEU", { USA: "red" }, palette));
  });
  it("plots native UTC dates and missing breaks, and only gives a large chart a range slider", () => {
    const option = buildResearchChartOption({ ...props, event }, palette, true, true);
    const series = option.series as {
      connectNulls?: boolean;
      data: { value: [number, number | null] }[];
      markLine?: { data: { yAxis?: number }[] };
      markArea?: { data: { name?: string }[][] };
    }[];
    expect(series[0]?.connectNulls).toBe(false);
    expect(series[0]?.data.at(-1)).toMatchObject({ symbolSize: 5 });
    expect(series[0]?.data.map(({ value }) => value)).toEqual([
      [dateNumber("2024-03-31"), 0],
      [dateNumber("2024-06-30"), null],
      [dateNumber("2024-09-30"), null],
      [dateNumber("2024-12-31"), 3],
    ]);
    expect(series[1]?.markLine?.data[0]).toEqual({ yAxis: 0 });
    expect(series[1]?.markArea?.data[0]?.[0]?.name).toContain("2024（年精度）");
    expect(option.dataZoom).toBeUndefined();
    expect(
      buildResearchChartOption(
        { ...props, height: 280, onRangeChange: () => {} },
        palette,
        true,
        true,
      ).dataZoom,
    ).toHaveLength(1);
  });
});
