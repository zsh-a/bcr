import { describe, expect, it } from "vitest";
import {
  debtChartObservations,
  debtExact,
  debtLatest,
  debtPeriodMonth,
  debtPhasePoint,
  debtQuarterIndex,
  debtQuarterPeriod,
} from "../src/debt/analysis";
import { parseDebtSnapshot } from "../src/debt/validation";
import { mergeDebtSnapshots } from "../src/debt/merge";
import type { DebtSeries, DebtSnapshot } from "../src/debt/model";

const base: DebtSeries = {
  country: "USA",
  indicator: "debtService",
  frequency: "Q",
  unit: "percentIncome",
  currency: null,
  seasonalAdjustment: "NSA",
  valuation: "notApplicable",
  source: {
    name: "BIS",
    url: "https://data.bis.org/topics/DSR",
    seriesCode: "TEST",
    licenseUrl: "https://data.bis.org/help/legal",
  },
  fetchedAt: "2026-10-25T00:00:00Z",
  sourceUpdatedAt: null,
  note: "Test input",
  observations: [],
};
const snapshot = (...series: DebtSeries[]): DebtSnapshot => ({
  version: 1,
  fetchedAt: base.fetchedAt,
  series,
});
const history = Array.from({ length: 41 }, (_, index) => ({
  period: debtQuarterPeriod(debtQuarterIndex("2016-Q1") + index),
  value: index < 40 ? 10 : 20,
}));
describe("debt periods, descriptive pressure and resource boundaries", () => {
  it("keeps native quarterly, monthly and annual endpoints distinct", () => {
    expect(debtPeriodMonth("2026-Q1")).toBe("2026-03");
    expect(debtPeriodMonth("2025")).toBe("2025-12");
    expect(debtPeriodMonth("2026-09")).toBe("2026-09");
    expect(debtQuarterPeriod(debtQuarterIndex("2025-Q4") + 1)).toBe("2026-Q1");
    expect(Number.isNaN(debtQuarterIndex("2026-Q5"))).toBe(true);
  });
  it("uses exactly forty preceding quarters and excludes current or future data from the DSR baseline", () => {
    const dsr = { ...base, observations: [...history, { period: "2026-Q2", value: 9999 }] },
      gap: DebtSeries = {
        ...base,
        indicator: "creditGap",
        unit: "percentagePoints",
        observations: [{ period: "2026-Q1", value: 0 }],
      };
    const point = debtPhasePoint(snapshot(dsr, gap), "USA", "2026-Q1");
    expect(point).toMatchObject({
      gap: 0,
      service: 20,
      baseline: 10,
      baselineCount: 40,
      serviceDeviation: 10,
    });
    expect(
      debtPhasePoint(snapshot({ ...dsr, observations: history.slice(1) }, gap), "USA", "2026-Q1"),
    ).toBeUndefined();
    expect(
      debtPhasePoint(
        snapshot(dsr, { ...gap, observations: [{ period: "2025-Q4", value: 0 }] }),
        "USA",
        "2026-Q1",
      ),
    ).toBeUndefined();
  });
  it("rejects a gap in the historical baseline and preserves actual zeros", () => {
    const gap: DebtSeries = {
      ...base,
      indicator: "creditGap",
      unit: "percentagePoints",
      observations: [{ period: "2026-Q1", value: 0 }],
    };
    expect(
      debtPhasePoint(
        snapshot(
          {
            ...base,
            observations: history.map((point, index) =>
              index === 10 ? { ...point, value: null } : point,
            ),
          },
          gap,
        ),
        "USA",
        "2026-Q1",
      ),
    ).toBeUndefined();
    const dsr = { ...base, observations: history.map((point) => ({ ...point, value: 0 })) };
    expect(debtPhasePoint(snapshot(dsr, gap), "USA", "2026-Q1")).toMatchObject({
      service: 0,
      baseline: 0,
      serviceDeviation: 0,
    });
  });
  it("never forward-fills a quarterly point, and labels a latest available reading with its true period", () => {
    const series = {
      ...base,
      observations: [
        { period: "2025-Q3", value: 0 },
        { period: "2025-Q4", value: null },
        { period: "2026-Q1", value: 12 },
      ],
    };
    expect(debtExact(series, "2025-Q4")).toBeNull();
    expect(debtLatest(series, "2025-Q4")).toEqual({ period: "2025-Q3", value: 0 });
    expect(debtLatest(series, "2026-02")).toEqual({ period: "2025-Q3", value: 0 });
  });
  it("inserts only chart separators across missing quarters and years without modifying original observations", () => {
    const series = {
      ...base,
      observations: [
        { period: "2025-Q3", value: 1 },
        { period: "2026-Q2", value: 2 },
      ],
    };
    expect(debtChartObservations(series)).toEqual([
      { period: "2025-Q3", value: 1 },
      { period: "2025-Q4", value: null },
      { period: "2026-Q1", value: null },
      { period: "2026-Q2", value: 2 },
    ]);
    expect(series.observations).toHaveLength(2);
    expect(
      debtChartObservations({
        ...base,
        frequency: "A",
        observations: [
          { period: "2023", value: 1 },
          { period: "2025", value: 2 },
        ],
      }),
    ).toEqual([
      { period: "2023", value: 1 },
      { period: "2024", value: null },
      { period: "2025", value: 2 },
    ]);
  });
  it("validates finite values, real calendar dates, native frequencies, uniqueness and local-currency units", () => {
    const valid = {
      ...base,
      observations: [
        { period: "2026-Q1", value: 0 },
        { period: "2025-Q4", value: null },
      ],
    };
    expect(parseDebtSnapshot(snapshot(valid)).series[0]?.observations[0]?.value).toBeNull();
    for (const invalid of [
      { ...valid, fetchedAt: "2026-02-30T00:00:00Z" },
      { ...valid, observations: [{ period: "2026-Q5", value: 1 }] },
      { ...valid, observations: [{ period: "2026-Q1", value: Infinity }] },
      {
        ...valid,
        observations: [
          { period: "2026-Q1", value: 1 },
          { period: "2026-Q1", value: 2 },
        ],
      },
      { ...valid, unit: "trillionLocal", currency: null },
      { ...valid, source: { ...valid.source, url: "javascript:alert(1)" } },
    ])
      expect(() => parseDebtSnapshot(snapshot(invalid as DebtSeries))).toThrow();
    expect(() => parseDebtSnapshot(snapshot(valid, valid))).toThrow();
  });
  it("merges whole source series by actual latest observation, preserving fiscal coverage and valuation notes", () => {
    const recent = { ...base, observations: [{ period: "2026-Q1", value: 12 }] },
      stale = {
        ...base,
        fetchedAt: "2026-10-26T00:00:00Z",
        note: "Different coverage",
        observations: [{ period: "2025-Q4", value: 99 }],
      };
    expect(mergeDebtSnapshots(snapshot(recent), snapshot(stale)).series[0]).toEqual(recent);
    const revised = {
      ...recent,
      fetchedAt: stale.fetchedAt,
      observations: [{ period: "2026-Q1", value: 13 }],
    };
    expect(mergeDebtSnapshots(snapshot(recent), snapshot(revised)).series[0]).toEqual(revised);
  });
});
