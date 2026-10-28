import { describe, expect, it } from "vitest";
import { deriveCycleSignals } from "../src/cycle/signals";
import { cycleSeriesHealth } from "../src/cycle/health";
import { monthPeriod, monthIndex } from "../src/cycle/analysis";
import type { CycleSeries, CycleSnapshot } from "../src/cycle/model";

const base: CycleSeries = {
  country: "USA",
  indicator: "payrolls",
  frequency: "M",
  unit: "thousandPersons",
  seasonalAdjustment: "SA",
  source: {
    name: "BLS",
    url: "https://www.bls.gov/",
    seriesCode: "PAYEMS",
    licenseUrl: "https://www.bls.gov/bls/linksite.htm",
  },
  fetchedAt: "2026-10-25T00:00:00Z",
  sourceUpdatedAt: null,
  observations: [],
};
const snapshot = (...series: CycleSeries[]): CycleSnapshot => ({
  version: 1,
  fetchedAt: base.fetchedAt,
  series,
});
describe("transparent policy, employment and price calculations", () => {
  it("calculates nonfarm net additions from exact adjacent months, preserving zero and negative changes", () => {
    const series = {
      ...base,
      observations: [
        { period: "2026-01", value: 100 },
        { period: "2026-02", value: 100 },
        { period: "2026-03", value: 90 },
        { period: "2026-05", value: 120 },
      ],
    };
    const result = deriveCycleSignals(snapshot(series))[0]!;
    expect(result.indicator).toBe("payrollChange");
    expect(result.observations.map((point) => point.value)).toEqual([null, 0, -10, null]);
    expect(result.source.seriesCode).toContain("derived-payrollChange");
    expect(result.observations[1]?.status).toBe("derived");
    expect(series.observations[2]?.value).toBe(90);
    expect(deriveCycleSignals(snapshot({ ...series, seasonalAdjustment: "NSA" }))).toEqual([]);
  });
  it("annualizes an exact three-month core-price ratio and requires all intervening months", () => {
    const series: CycleSeries = {
      ...base,
      indicator: "corePriceIndex",
      unit: "index",
      observations: [
        { period: "2026-01", value: 100 },
        { period: "2026-02", value: 100.2 },
        { period: "2026-03", value: 100.5 },
        { period: "2026-04", value: 101 },
      ],
    };
    expect(deriveCycleSignals(snapshot(series))[0]?.observations.at(-1)?.value).toBeCloseTo(
      (1.01 ** 4 - 1) * 100,
    );
    expect(
      deriveCycleSignals(
        snapshot({
          ...series,
          observations: series.observations.filter((point) => point.period !== "2026-02"),
        }),
      )[0]?.observations.at(-1)?.value,
    ).toBeNull();
    expect(
      deriveCycleSignals(
        snapshot({
          ...series,
          observations: series.observations.map((point) =>
            point.period === "2026-01" ? { ...point, value: 0 } : point,
          ),
        }),
      )[0]?.observations.at(-1)?.value,
    ).toBeNull();
    expect(deriveCycleSignals(snapshot({ ...series, seasonalAdjustment: "NSA" }))).toEqual([]);
  });
  it("subtracts same-country same-month inflation without carrying an older CPI forward", () => {
    const policy: CycleSeries = {
      ...base,
      indicator: "policyRate",
      unit: "percent",
      seasonalAdjustment: "NSA",
      source: { ...base.source, seriesCode: "M.US" },
      observations: [
        { period: "2026-08", value: 5 },
        { period: "2026-09", value: 4.5 },
      ],
    };
    const cpi: CycleSeries = {
      ...base,
      indicator: "inflation",
      unit: "percent",
      fetchedAt: "2026-10-25T01:00:00Z",
      source: { ...base.source, seriesCode: "CPI-YOY" },
      observations: [{ period: "2026-08", value: 2 }],
    };
    const result = deriveCycleSignals(snapshot(policy, cpi))[0]!;
    expect(result.indicator).toBe("realPolicyRate");
    expect(result.observations.map((point) => point.value)).toEqual([3, null]);
    expect(result.fetchedAt).toBe(cpi.fetchedAt);
    expect(result.sourceUpdatedAt).toBeNull();
    expect(result.note).toContain("CPI-YOY");
    expect(deriveCycleSignals(snapshot(policy, { ...cpi, country: "JPN" }))).toEqual([]);
  });
  it("uses only available current and past months for the US descriptive unemployment gap", () => {
    const observations = Array.from({ length: 15 }, (_, index) => ({
      period: monthPeriod(monthIndex("2025-01") + index),
      value: index < 13 ? 5 : index === 13 ? 6 : 99,
    }));
    const series: CycleSeries = {
      ...base,
      indicator: "unemployment",
      unit: "percent",
      observations,
    };
    const derived = deriveCycleSignals(snapshot(series))[0]!;
    expect(derived.observations.find((point) => point.period === "2026-02")?.value).toBeCloseTo(
      1 / 3,
    );
    expect(derived.observations[12]?.value).toBeNull();
    expect(derived.note).toContain("不是实时萨姆");
    const missing = {
      ...series,
      observations: observations.map((point, index) =>
        index === 4 ? { ...point, value: null } : point,
      ),
    };
    expect(
      deriveCycleSignals(snapshot(missing))[0]?.observations.find(
        (point) => point.period === "2026-02",
      )?.value,
    ).toBeNull();
    expect(deriveCycleSignals(snapshot({ ...series, country: "JPN" }))).toEqual([]);
  });
  it("returns zero when the current three-month unemployment mean is the lowest in the window", () => {
    const series: CycleSeries = {
      ...base,
      indicator: "unemployment",
      unit: "percent",
      observations: Array.from({ length: 14 }, (_, index) => ({
        period: monthPeriod(monthIndex("2025-01") + index),
        value: index < 11 ? 6 : 5,
      })),
    };
    expect(deriveCycleSignals(snapshot(series))[0]?.observations.at(-1)?.value).toBe(0);
  });
});
describe("native-frequency data coverage", () => {
  it("counts missing months against the selected calendar window, retaining actual dates and zeros", () => {
    const series: CycleSeries = {
      ...base,
      indicator: "policyRate",
      unit: "percent",
      observations: [
        { period: "2026-01", value: 0 },
        { period: "2026-02", value: null },
        { period: "2026-04", value: 1 },
      ],
    };
    expect(cycleSeriesHealth(series, "2026-01", "2026-06")).toMatchObject({
      valid: 2,
      reported: 3,
      expected: 6,
      coverage: 1 / 3,
      latestPeriod: "2026-04",
      ageMonths: 2,
    });
    expect(cycleSeriesHealth(series, "2026-01", "2026-03")).toMatchObject({
      valid: 1,
      expected: 3,
      latestPeriod: "2026-01",
      ageMonths: 2,
    });
  });
  it("counts quarter ends and never invents missing weekends for daily data", () => {
    const series: CycleSeries = {
      ...base,
      indicator: "realHousePrices",
      frequency: "Q",
      unit: "percent",
      observations: [
        { period: "2025-Q4", value: 0 },
        { period: "2026-Q1", value: 2 },
      ],
    };
    expect(cycleSeriesHealth(series, "2025-10", "2026-05")).toMatchObject({
      valid: 2,
      expected: 2,
      latestPeriod: "2026-Q1",
      ageMonths: 2,
    });
    const daily: CycleSeries = {
      ...series,
      frequency: "D",
      observations: [
        { period: "2026-10-16", value: 1 },
        { period: "2026-10-19", value: 2 },
      ],
    };
    expect(cycleSeriesHealth(daily, "2026-10", "2026-10")).toMatchObject({
      valid: 2,
      reported: 2,
      expected: null,
      coverage: null,
    });
  });
});
