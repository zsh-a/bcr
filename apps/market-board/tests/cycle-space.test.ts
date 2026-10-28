import { describe, expect, it } from "vitest";
import type { CycleSpacePoint } from "@bcr/market-data/cycle";
import {
  cycleMonth,
  cyclePeriod,
  cycleSpacePosition,
  prepareCycleSpace,
} from "../src/cycle/cycle-space";

const countries = [{ id: "USA", name: "美国", color: "#82aef7" }];
const point = (period: string, level = 100, momentum = 0, country = "USA"): CycleSpacePoint => ({
  country,
  period,
  level,
  momentum,
  phase: "flat",
});

describe("cycle phase-space geometry", () => {
  it("keeps historical extremes and scales fixed while changing the selected month", () => {
    const points = [
      point("2009-01", 80, -10),
      point("2026-01", 102, 0.5),
      point("2026-02", 101, -0.5),
    ];
    const first = prepareCycleSpace(points, countries, "2026-01"),
      second = prepareCycleSpace(points, countries, "2026-02");
    expect(first.extent).toEqual(second.extent);
    expect(first.extent.x).toBeGreaterThan(20);
    expect(first.extent.y).toBeGreaterThan(10);
    expect(first.series[0]?.points.map((item) => item.period)).toEqual(["2026-01"]);
    expect(points[0]?.level).toBe(80);
  });
  it("breaks trails at missing months and never forward-fills a current marker", () => {
    const model = prepareCycleSpace(
      [point("2026-05"), point("2026-01"), point("2026-04"), point("2026-02")],
      countries,
      "2026-06",
    );
    expect(model.series[0]?.segments.map(([from, to]) => [from.period, to.period])).toEqual([
      ["2026-01", "2026-02"],
      ["2026-04", "2026-05"],
    ]);
    expect(model.series[0]?.current).toBeNull();
  });
  it("shows exactly 36 calendar months with past and future points excluded", () => {
    const points = Array.from({ length: 38 }, (_, index) =>
      point(cyclePeriod(cycleMonth("2023-09")! + index)),
    );
    const model = prepareCycleSpace(points, countries, "2026-09"),
      series = model.series[0]!;
    expect(model.from).toBe("2023-10");
    expect(series.points).toHaveLength(36);
    expect(series.points[0]?.period).toBe("2023-10");
    expect(series.current?.period).toBe("2026-09");
    expect(series.segments).toHaveLength(35);
    expect(cycleSpacePosition(series.points[0]!, model)[2]).toBeCloseTo(-3.6);
    expect(cycleSpacePosition(series.current!, model)[2]).toBeCloseTo(2.8);
  });
  it("rejects invalid observations and duplicate country-month rows without corrupting bounds", () => {
    const model = prepareCycleSpace(
      [
        point("2026-09", 101, 0.1),
        point("2026-09", 9999),
        point("2026-13", -9999),
        point("2026-08", Number.NaN),
        point("2026-07", 100, Infinity),
        point("2026-06", 9999, 1, "unknown"),
      ],
      countries,
      "2026-09",
    );
    expect(model.series[0]?.points).toHaveLength(1);
    expect(model.series[0]?.current?.level).toBe(101);
    expect(model.extent.x).toBe(2);
    expect(model.extent.y).toBe(0.2);
    const [x, y] = cycleSpacePosition(model.series[0]!.current!, model);
    expect(Math.abs(x)).toBeLessThanOrEqual(4);
    expect(Math.abs(y)).toBeLessThanOrEqual(2.6);
  });
  it("returns no fabricated observations for invalid selection periods", () => {
    expect(cycleMonth("2026-13")).toBeNull();
    const model = prepareCycleSpace([point("2026-09")], countries, "invalid");
    expect(model.from).toBe("");
    expect(model.series[0]?.points).toEqual([]);
    expect(model.series[0]?.current).toBeNull();
  });
});
