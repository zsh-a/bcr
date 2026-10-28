import { describe, expect, it } from "vitest";
import { createEconomicRepository, queryEconomicTracks } from "../src/economy";
import type { CycleSeries } from "../src/cycle/model";
import type { DebtSeries } from "../src/debt/model";
import type { EconomicQuery } from "../src/economy/model";

const fetchedAt = "2026-10-25T12:00:00Z";
const base: CycleSeries = {
  country: "USA",
  indicator: "policyRate",
  frequency: "M",
  unit: "percent",
  seasonalAdjustment: "NSA",
  source: { name: "Official", url: "https://data.bis.org/", seriesCode: "M.US" },
  fetchedAt,
  sourceUpdatedAt: null,
  observations: [],
};
const repository = (series: CycleSeries) =>
  createEconomicRepository({
    annual: null,
    debt: null,
    cycle: { version: 1, fetchedAt, series: [series] },
  });
const query: EconomicQuery = {
  metricId: "cycle:policyRate",
  countries: ["USA"],
  range: ["2024-01-01", "2024-06-30"],
  cutoff: "2024-06-30",
};

describe("strict economic windows and native readings", () => {
  it("clamps every output at min(rangeEnd, cutoff), including daily values inside a selected month", () => {
    const source: CycleSeries = {
      ...base,
      frequency: "D",
      observations: [
        { period: "2024-04-01", value: 1 },
        { period: "2024-04-15", value: 2 },
        { period: "2024-04-16", value: 3 },
      ],
    };
    const snapshot = repository(source);
    const [track] = queryEconomicTracks(snapshot, {
      ...query,
      range: ["2024-04-01", "2024-04-30"],
      cutoff: "2024-04-15",
    });
    expect(track?.points.map((point) => point.period)).toEqual(["2024-04-01", "2024-04-15"]);
    expect(track?.plot.map((point) => point.period)).toEqual(["2024-04-01", "2024-04-15"]);
    expect(track?.reading?.period).toBe("2024-04-15");
    const [limited] = queryEconomicTracks(snapshot, {
      ...query,
      range: ["2024-04-01", "2024-04-15"],
      cutoff: "2024-06-30",
    });
    expect(limited?.points).toEqual(track?.points);
    expect(limited?.reading).toEqual(track?.reading);
    expect(track?.coverage.expected).toBeNull();
  });

  it("keeps original nulls and zero, inserts chart-only month gaps and never carries a value forward", () => {
    const snapshot = repository({
      ...base,
      observations: [
        { period: "2024-01", value: 0 },
        { period: "2024-02", value: null },
        { period: "2024-04", value: -1 },
      ],
    });
    const [track] = queryEconomicTracks(snapshot, query);
    expect(track?.points.map((point) => [point.period, point.value])).toEqual([
      ["2024-01", 0],
      ["2024-02", null],
      ["2024-04", -1],
    ]);
    expect(track?.plot.map((point) => [point.period, point.value])).toEqual([
      ["2024-01", 0],
      ["2024-02", null],
      ["2024-03", null],
      ["2024-04", -1],
      ["2024-05", null],
      ["2024-06", null],
    ]);
    expect(track?.coverage).toEqual({ valid: 2, reported: 3, expected: 6 });
    expect(track?.reading).toMatchObject({
      period: "2024-04",
      date: "2024-04-30",
      value: -1,
      rawValue: -1,
      ageMonths: 2,
      change: null,
      previousPeriod: null,
    });
    expect(
      queryEconomicTracks(snapshot, { ...query, cutoff: "2024-01-31" })[0]?.reading?.value,
    ).toBe(0);
  });

  it("calculates native adjacent changes only, even when another nonnull value is nearby", () => {
    const snapshot = repository({
      ...base,
      observations: [
        { period: "2024-01", value: 0 },
        { period: "2024-02", value: -1 },
        { period: "2024-03", value: null },
        { period: "2024-04", value: 5 },
      ],
    });
    expect(
      queryEconomicTracks(snapshot, { ...query, cutoff: "2024-02-29" })[0]?.reading,
    ).toMatchObject({ change: -1, previousPeriod: "2024-01" });
    expect(
      queryEconomicTracks(snapshot, { ...query, cutoff: "2024-04-30" })[0]?.reading,
    ).toMatchObject({ change: null, previousPeriod: null });
    expect(
      queryEconomicTracks(snapshot, { ...query, cutoff: "2024-03-31" })[0]?.reading,
    ).toMatchObject({ period: "2024-02", ageMonths: 1 });
  });

  it("returns an explicitly dated old reading outside the range and counts no false window observations", () => {
    const snapshot = repository({ ...base, observations: [{ period: "2022-12", value: 2 }] });
    const [track] = queryEconomicTracks(snapshot, query);
    expect(track?.points).toEqual([]);
    expect(track?.coverage).toEqual({ valid: 0, reported: 0, expected: 6 });
    expect(track?.reading).toMatchObject({ period: "2022-12", ageMonths: 18, value: 2 });
    expect(
      queryEconomicTracks(snapshot, { ...query, cutoff: "2021-12-31" })[0]?.reading,
    ).toBeNull();
    expect(queryEconomicTracks(snapshot, { ...query, cutoff: "2021-12-31" })[0]?.plot).toEqual([]);
  });

  it("counts quarter ends and refuses to show a reference quarter before its own end date", () => {
    const snapshot = repository({
      ...base,
      frequency: "Q",
      observations: [
        { period: "2024-Q1", value: 1 },
        { period: "2024-Q3", value: 3 },
      ],
    });
    const [early] = queryEconomicTracks(snapshot, {
      ...query,
      range: ["2024-02-01", "2024-09-30"],
      cutoff: "2024-03-30",
    });
    expect(early?.points).toEqual([]);
    expect(early?.coverage.expected).toBe(0);
    expect(early?.reading).toBeNull();
    const [full] = queryEconomicTracks(snapshot, {
      ...query,
      range: ["2024-02-01", "2024-09-30"],
      cutoff: "2024-09-30",
    });
    expect(full?.coverage).toEqual({ valid: 2, reported: 2, expected: 3 });
    expect(full?.plot.map((point) => [point.period, point.date, point.value])).toEqual([
      ["2024-Q1", "2024-03-31", 1],
      ["2024-Q2", "2024-06-30", null],
      ["2024-Q3", "2024-09-30", 3],
    ]);
    expect(full?.reading?.change).toBeNull();
  });

  it("keeps annual years separate from monthly positions and requires the prior calendar year for change", () => {
    const series: DebtSeries = {
      country: "USA",
      indicator: "fiscalBalance",
      frequency: "A",
      unit: "percentGdp",
      currency: null,
      seasonalAdjustment: "notApplicable",
      valuation: "notApplicable",
      source: { ...base.source, licenseUrl: "https://data.worldbank.org/license" },
      fetchedAt,
      sourceUpdatedAt: null,
      note: "年度财政覆盖。",
      observations: [
        { period: "2021", value: -2 },
        { period: "2023", value: 0 },
        { period: "2024", value: -1 },
      ],
    };
    const snapshot = createEconomicRepository({
      annual: null,
      cycle: null,
      debt: { version: 1, fetchedAt, series: [series] },
    });
    const window = {
      ...query,
      metricId: "debt:fiscalBalance",
      range: ["2021-01-01", "2024-12-31"] as [string, string],
      cutoff: "2024-12-31",
    };
    const [track] = queryEconomicTracks(snapshot, window);
    expect(track?.coverage).toEqual({ valid: 3, reported: 3, expected: 4 });
    expect(track?.plot.map((point) => point.period)).toEqual(["2021", "2022", "2023", "2024"]);
    expect(track?.reading).toMatchObject({ period: "2024", change: -1, previousPeriod: "2023" });
    expect(
      queryEconomicTracks(snapshot, { ...window, cutoff: "2023-12-31" })[0]?.reading,
    ).toMatchObject({ period: "2023", value: 0, change: null });
  });

  it("preserves weekly dates, requires seven days for changes and never inserts speculative missing publishing weeks", () => {
    const snapshot = repository({
      ...base,
      frequency: "W",
      observations: [
        { period: "2024-01-05", value: 1 },
        { period: "2024-01-12", value: 0 },
        { period: "2024-01-26", value: 2 },
      ],
    });
    const [adjacent] = queryEconomicTracks(snapshot, { ...query, cutoff: "2024-01-12" });
    expect(adjacent?.reading).toMatchObject({
      period: "2024-01-12",
      date: "2024-01-12",
      change: -1,
      previousPeriod: "2024-01-05",
    });
    expect(adjacent?.coverage.expected).toBeNull();
    const [gap] = queryEconomicTracks(snapshot, query);
    expect(gap?.reading?.change).toBeNull();
    expect(gap?.plot).toEqual(gap?.points);
    expect(gap?.plot.map((point) => point.period)).not.toContain("2024-01-19");
  });

  it("does not treat a weekend or holiday gap as an adjacent daily observation", () => {
    const snapshot = repository({
      ...base,
      frequency: "D",
      observations: [
        { period: "2024-02-28", value: 0 },
        { period: "2024-02-29", value: 1 },
        { period: "2024-03-01", value: 2 },
        { period: "2024-03-04", value: 3 },
      ],
    });
    expect(
      queryEconomicTracks(snapshot, { ...query, cutoff: "2024-02-29" })[0]?.reading,
    ).toMatchObject({ change: 1, previousPeriod: "2024-02-28" });
    const [track] = queryEconomicTracks(snapshot, query);
    expect(track?.reading?.change).toBeNull();
    expect(track?.plot).toHaveLength(4);
  });

  it("deduplicates requested countries, returns no invented series and rejects invalid date ranges", () => {
    const snapshot = repository({ ...base, observations: [{ period: "2024-01", value: 0 }] });
    expect(
      queryEconomicTracks(snapshot, { ...query, countries: ["USA", "USA", "CHN"] }),
    ).toHaveLength(1);
    expect(queryEconomicTracks(snapshot, { ...query, metricId: "annual:inflation" })).toEqual([]);
    expect(queryEconomicTracks(snapshot, { ...query, countries: [] })).toEqual([]);
    expect(() => queryEconomicTracks(snapshot, { ...query, cutoff: "2024-02-30" })).toThrow(
      /YYYY-MM-DD/u,
    );
    expect(() =>
      queryEconomicTracks(snapshot, { ...query, range: ["2025-01-01", "2024-01-01"] }),
    ).toThrow(/有序/u);
  });
});
