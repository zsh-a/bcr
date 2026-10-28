import { describe, expect, it } from "vitest";
import {
  cycleDisplayObservations,
  cycleDisplayUnit,
  cycleExact,
  cycleLatest,
  cyclePeriods,
  cyclePhase,
  cyclePoint,
  cycleSpacePoints,
  monthIndex,
  observationMonth,
  shiftMonth,
  threeMonthGrowth,
} from "../src/cycle/analysis";
import { CYCLE_INDICATORS, CYCLE_PHASE_LABELS } from "../src/cycle/catalog";
import { mergeCycleSnapshots } from "../src/cycle/merge";
import type { CycleObservation, CycleSeries, CycleSnapshot } from "../src/cycle/model";
import { parseCycleSnapshot } from "../src/cycle/validation";

const fetchedAt = "2026-10-25T12:00:00Z";
const points = (entries: [string, number | null][]): CycleObservation[] =>
  entries.map(([period, value]) => ({ period, value }));
function series(entries: [string, number | null][], patch: Partial<CycleSeries> = {}): CycleSeries {
  return {
    country: "USA",
    indicator: "cli",
    frequency: "M",
    unit: "index",
    seasonalAdjustment: "SA",
    source: {
      name: "Official test fixture",
      url: "https://example.org/series",
      seriesCode: "fixture",
      licenseUrl: "https://example.org/license",
    },
    fetchedAt,
    sourceUpdatedAt: null,
    observations: points(entries),
    ...patch,
  };
}
const snapshot = (...items: CycleSeries[]): CycleSnapshot => ({
  version: 1,
  fetchedAt,
  series: items,
});
const growthSeries = () =>
  series(
    [
      ["2026-01", 90],
      ["2026-02", 110],
      ["2026-03", 100],
      ["2026-04", 105],
      ["2026-05", 115],
      ["2026-06", 110],
    ],
    { indicator: "industrialProduction" },
  );

describe("CLI level and exact three-month momentum", () => {
  it("uses the value exactly three calendar months earlier, not the preceding observation", () => {
    const data = snapshot(
      series([
        ["2026-01", 98],
        ["2026-03", 99.5],
        ["2026-04", 100.5],
      ]),
    );
    expect(cyclePoint(data, "USA", "2026-04")).toEqual({
      country: "USA",
      period: "2026-04",
      level: 100.5,
      momentum: 2.5,
      phase: "aboveRising",
    });
  });

  it("does not fill a missing or null comparison month and requires the selected month's actual value", () => {
    const missing = snapshot(
      series([
        ["2026-02", 98],
        ["2026-03", 99],
        ["2026-04", 100],
      ]),
    );
    expect(cyclePoint(missing, "USA", "2026-04")).toBeUndefined();
    expect(
      cyclePoint(
        snapshot(
          series([
            ["2026-01", null],
            ["2026-04", 100],
          ]),
        ),
        "USA",
        "2026-04",
      ),
    ).toBeUndefined();
    expect(
      cyclePoint(
        snapshot(
          series([
            ["2026-01", 99],
            ["2026-03", 100],
          ]),
        ),
        "USA",
        "2026-04",
      ),
    ).toBeUndefined();
  });

  it("separates the four trend quadrants and flat momentum without declaring recession", () => {
    expect(cyclePhase(101, 0.5)).toBe("aboveRising");
    expect(cyclePhase(101, -0.5)).toBe("aboveFalling");
    expect(cyclePhase(99, -0.5)).toBe("belowFalling");
    expect(cyclePhase(99, 0.5)).toBe("belowRising");
    expect(cyclePhase(100, 0.1)).toBe("aboveRising");
    expect(cyclePhase(99, 0)).toBe("flat");
    expect(cyclePhase(99, 1e-12)).toBe("flat");
    expect(Object.values(CYCLE_PHASE_LABELS).every((label) => !label.includes("衰退"))).toBe(true);
    expect(CYCLE_INDICATORS.find((item) => item.id === "cli")?.description).toContain(
      "不等于 GDP 负增长",
    );
  });

  it("includes only exact valid points inside the requested trail window", () => {
    const data = snapshot(
      series([
        ["2026-01", 98],
        ["2026-02", 98.5],
        ["2026-04", 99],
        ["2026-05", 100],
        ["2026-06", 101],
      ]),
    );
    expect(cycleSpacePoints(data, ["USA"], "2026-06", 3).map((point) => point.period)).toEqual([
      "2026-04",
      "2026-05",
    ]);
  });

  it("prefers common valid comparison periods and keeps a union when no common period exists", () => {
    const usa = series([
      ["2026-01", 99],
      ["2026-02", 99],
      ["2026-04", 100],
      ["2026-05", 100],
    ]);
    const japan = series(
      [
        ["2026-02", 99],
        ["2026-05", 100],
      ],
      { country: "JPN" },
    );
    expect(cyclePeriods(snapshot(usa, japan), ["USA", "JPN"])).toEqual(["2026-05"]);
    const separate = series(
      [
        ["2026-03", 99],
        ["2026-06", 100],
      ],
      { country: "JPN" },
    );
    expect(cyclePeriods(snapshot(usa, separate), ["USA", "JPN"])).toEqual([
      "2026-04",
      "2026-05",
      "2026-06",
    ]);
  });
});

describe("adjacent three-month average growth", () => {
  it("compares two three-month means as a nonannualized rate", () => {
    // Jan–Mar average=100, Apr–Jun average=110: +10%, rather than (1.1^4−1)=46.41%.
    expect(threeMonthGrowth(growthSeries(), "2026-06")).toBeCloseTo(10, 12);
  });

  it("requires six consecutive calendar months even when six other observations exist", () => {
    const missing = growthSeries();
    missing.observations = [
      { period: "2025-12", value: 100 },
      ...missing.observations.filter((point) => point.period !== "2026-02"),
    ];
    expect(missing.observations).toHaveLength(6);
    expect(threeMonthGrowth(missing, "2026-06")).toBeNull();
    const explicit = growthSeries();
    explicit.observations[4]!.value = null;
    expect(threeMonthGrowth(explicit, "2026-06")).toBeNull();
  });

  it("refuses unadjusted series, percentage rates and nonmonthly frequencies", () => {
    for (const seasonalAdjustment of ["NSA", "notApplicable"] as const)
      expect(threeMonthGrowth({ ...growthSeries(), seasonalAdjustment }, "2026-06")).toBeNull();
    for (const unit of ["percent", "percentagePoints"] as const)
      expect(threeMonthGrowth({ ...growthSeries(), unit }, "2026-06")).toBeNull();
    for (const frequency of ["Q", "W", "D"] as const)
      expect(threeMonthGrowth({ ...growthSeries(), frequency }, "2026-06")).toBeNull();
  });

  it("rejects a zero comparison mean but retains an actual zero current level", () => {
    const data = growthSeries();
    data.observations.slice(0, 3).forEach((point) => {
      point.value = 0;
    });
    expect(threeMonthGrowth(data, "2026-06")).toBeNull();
    const zero = growthSeries();
    zero.observations.slice(3).forEach((point) => {
      point.value = 0;
    });
    expect(threeMonthGrowth(zero, "2026-06")).toBe(-100);
  });
});

describe("annual change from monthly level observations", () => {
  it("requires the exact same month one year earlier rather than a nearby available observation", () => {
    const data = series(
      [
        ["2025-01", 100],
        ["2025-12", 105],
        ["2026-01", 110],
      ],
      { indicator: "industrialProduction" },
    );
    expect(cycleDisplayObservations(data).at(-1)?.value).toBeCloseTo(10, 12);
    expect(cycleDisplayUnit(data)).toBe("percent");
    const missing = {
      ...data,
      observations: data.observations.filter((point) => point.period !== "2025-01"),
    };
    expect(cycleDisplayObservations(missing).at(-1)?.value).toBeNull();
    expect(data.observations.at(-1)?.value).toBe(110);
  });

  it("preserves missing/zero semantics and does not divide by a zero previous level", () => {
    const data = series(
      [
        ["2025-01", 0],
        ["2025-02", null],
        ["2025-03", 100],
        ["2026-01", 110],
        ["2026-02", 100],
        ["2026-03", 0],
      ],
      { indicator: "retailVolume" },
    );
    const displayed = cycleDisplayObservations(data);
    expect(displayed.find((point) => point.period === "2026-01")?.value).toBeNull();
    expect(displayed.find((point) => point.period === "2026-02")?.value).toBeNull();
    expect(displayed.find((point) => point.period === "2026-03")?.value).toBe(-100);
  });

  it("keeps source-supplied percentage growth, quarter data and CLI levels unchanged", () => {
    const rate = series([["2026-09", 5.5]], {
      indicator: "industrialProduction",
      unit: "percent",
      seasonalAdjustment: "NSA",
    });
    expect(cycleDisplayObservations(rate)).toEqual(rate.observations);
    const quarter = series([["2026-Q3", 105]], {
      indicator: "industrialProduction",
      frequency: "Q",
    });
    expect(cycleDisplayObservations(quarter)).toEqual(quarter.observations);
    const cli = series([["2026-09", 99.5]]);
    expect(cycleDisplayObservations(cli)).toEqual(cli.observations);
    expect(cycleDisplayUnit(cli)).toBe("index");
  });
});

describe("period and frequency boundaries", () => {
  it("shifts exact months across years and rejects malformed monthly indexes", () => {
    expect(shiftMonth("2026-01", -3)).toBe("2025-10");
    expect(shiftMonth("2025-12", 1)).toBe("2026-01");
    expect(monthIndex("2026-01") - monthIndex("2025-12")).toBe(1);
    for (const period of ["2026-00", "2026-13", "2026-1", "2026-Q1", "2026-01-01"])
      expect(Number.isNaN(monthIndex(period))).toBe(true);
  });

  it("places quarterly observations at quarter end and retains original observation labels", () => {
    expect(observationMonth("2026-Q1")).toBe("2026-03");
    expect(observationMonth("2026-Q4")).toBe("2026-12");
    expect(observationMonth("2026-07-17")).toBe("2026-07");
    const data = series(
      [
        ["2026-Q1", 1],
        ["2026-Q2", 2],
        ["2026-Q3", null],
      ],
      { indicator: "gdpGrowth", frequency: "Q", unit: "percent" },
    );
    expect(cycleLatest(data, "2026-05")).toEqual({ period: "2026-Q1", value: 1 });
    expect(cycleLatest(data, "2026-09")).toEqual({ period: "2026-Q2", value: 2 });
    expect(cycleLatest(data, "2026-02")).toBeUndefined();
    expect(cycleExact(data, "2026-Q3")).toBeNull();
  });
});

describe("whole-series merge and provenance", () => {
  it("keeps later actual coverage when a newly fetched source ends earlier or has trailing nulls", () => {
    const current = series(
      [
        ["2026-08", 101],
        ["2026-09", 102],
      ],
      {
        source: { name: "Current", url: "https://example.org/current", seriesCode: "current" },
        fetchedAt: "2026-10-20T00:00:00Z",
      },
    );
    const stale = series(
      [
        ["2026-06", 110],
        ["2026-09", null],
        ["2026-10", null],
      ],
      { fetchedAt: "2026-10-25T00:00:00Z" },
    );
    const merged = mergeCycleSnapshots(snapshot(current), snapshot(stale));
    expect(merged.series[0]?.source.seriesCode).toBe("current");
    expect(merged.series[0]?.observations).toEqual(current.observations);
  });

  it("uses fetch time only to break equal-coverage ties and replaces whole bases without splicing", () => {
    const older = series(
      [
        ["2025-01", 98],
        ["2026-08", 100],
      ],
      {
        indicator: "industrialProduction",
        fetchedAt: "2026-10-20T00:00:00Z",
        source: { name: "2015 base", url: "https://example.org/old", seriesCode: "base2015" },
      },
    );
    const rebased = series(
      [
        ["2026-07", 202],
        ["2026-08", 204],
      ],
      {
        indicator: "industrialProduction",
        fetchedAt: "2026-10-25T00:00:00Z",
        source: { name: "2025 base", url: "https://example.org/new", seriesCode: "base2025" },
      },
    );
    const merged = mergeCycleSnapshots(snapshot(older), snapshot(rebased));
    expect(merged.series).toHaveLength(1);
    expect(merged.series[0]?.observations).toEqual(rebased.observations);
    expect(merged.series[0]?.source.seriesCode).toBe("base2025");
    expect(merged.series[0]?.observations.some((point) => point.period === "2025-01")).toBe(false);
  });

  it("retains independent indicators/countries and allows actual zero as the latest observation", () => {
    const usa = series([["2026-09", 100]]),
      japan = series([["2026-09", 99]], { country: "JPN" });
    const newer = series([["2026-10", 0]]);
    const unemployment = series([["2026-09", 4]], { indicator: "unemployment", unit: "percent" });
    const merged = mergeCycleSnapshots(snapshot(usa, japan), snapshot(newer, unemployment));
    expect(merged.series).toHaveLength(3);
    expect(
      merged.series.find((item) => item.country === "USA" && item.indicator === "cli")
        ?.observations,
    ).toEqual([{ period: "2026-10", value: 0 }]);
    expect(merged.series.find((item) => item.country === "JPN")?.observations).toEqual(
      japan.observations,
    );
  });

  it("compares the full weekly/date period so a later fetch cannot replace newer same-month observations", () => {
    const recent = series([["2026-10-23", 210000]], {
      indicator: "initialClaims",
      frequency: "W",
      unit: "persons",
      fetchedAt: "2026-10-24T00:00:00Z",
    });
    const stale = series([["2026-10-09", 220000]], {
      indicator: "initialClaims",
      frequency: "W",
      unit: "persons",
      fetchedAt: "2026-10-25T00:00:00Z",
    });
    expect(mergeCycleSnapshots(snapshot(recent), snapshot(stale)).series[0]?.observations).toEqual(
      recent.observations,
    );
  });
});

describe("snapshot input validation", () => {
  it("sorts valid observations while preserving zero, null, statuses and unknown source update date", () => {
    const input = snapshot(
      series([
        ["2026-09", null],
        ["2026-07", 0],
        ["2026-08", 1],
      ]),
    );
    input.series[0]!.observations[1]!.status = "P";
    const output = parseCycleSnapshot(input);
    expect(output.series[0]?.observations).toEqual([
      { period: "2026-07", value: 0, status: "P" },
      { period: "2026-08", value: 1 },
      { period: "2026-09", value: null },
    ]);
    expect(output.series[0]?.sourceUpdatedAt).toBeNull();
    expect(input.series[0]?.observations[0]?.period).toBe("2026-09");
  });

  it("rejects duplicate country-indicator series and duplicate observation periods", () => {
    expect(() =>
      parseCycleSnapshot(snapshot(series([["2026-09", 0]]), series([["2026-09", null]]))),
    ).toThrow();
    expect(() =>
      parseCycleSnapshot(
        snapshot(
          series([
            ["2026-09", 1],
            ["2026-09", 1],
          ]),
        ),
      ),
    ).toThrow();
  });

  it("rejects invalid calendar periods according to the declared frequency", () => {
    for (const period of ["2026-00", "2026-13", "2026-09-01"])
      expect(() => parseCycleSnapshot(snapshot(series([[period, 1]])))).toThrow();
    for (const period of ["2026-Q0", "2026-Q5", "2026-03"])
      expect(() =>
        parseCycleSnapshot(snapshot(series([[period, 1]], { frequency: "Q" }))),
      ).toThrow();
    for (const frequency of ["W", "D"] as const) {
      for (const period of ["2026-02-30", "2026-04-31", "2026-01-00"])
        expect(() => parseCycleSnapshot(snapshot(series([[period, 1]], { frequency })))).toThrow();
      expect(
        parseCycleSnapshot(snapshot(series([["2024-02-29", 1]], { frequency }))).series[0]
          ?.observations[0]?.period,
      ).toBe("2024-02-29");
    }
  });

  it("rejects malformed values, metadata and insecure source URLs", () => {
    for (const value of [Number.NaN, Infinity, -Infinity, "0", undefined]) {
      const input = snapshot(series([["2026-09", 1]])) as unknown as {
        series: { observations: { value: unknown }[] }[];
      };
      input.series[0]!.observations[0]!.value = value;
      expect(() => parseCycleSnapshot(input)).toThrow();
    }
    expect(() => parseCycleSnapshot({ ...snapshot(), version: 2 })).toThrow();
    expect(() => parseCycleSnapshot({ ...snapshot(), fetchedAt: "not-a-date" })).toThrow();
    expect(() =>
      parseCycleSnapshot(
        snapshot(
          series([["2026-09", 1]], {
            source: { name: "Bad", url: "http://example.org", seriesCode: "bad" },
          }),
        ),
      ),
    ).toThrow();
  });

  it("rejects impossible calendar dates in provenance metadata instead of silently rolling into another month", () => {
    expect(() =>
      parseCycleSnapshot({
        ...snapshot(series([["2026-09", 1]])),
        fetchedAt: "2026-02-30T12:00:00Z",
      }),
    ).toThrow();
    expect(() =>
      parseCycleSnapshot(snapshot(series([["2026-09", 1]], { sourceUpdatedAt: "2026-02-30" }))),
    ).toThrow();
    expect(() =>
      parseCycleSnapshot(snapshot(series([["2026-09", 1]], { fetchedAt: "2026-02-30T12:00:00Z" }))),
    ).toThrow();
  });
});
