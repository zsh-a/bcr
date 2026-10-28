import { describe, expect, it } from "vitest";
import { bundledCycleSnapshot, getCycleSeries, type CycleSnapshot } from "@bcr/market-data/cycle";
import { cycleTrendEnd, cycleViewUrl, parseCycleState } from "../src/cycle/state";
import { cycleCsv, cycleTableSeries } from "../src/cycle/CycleData";
import { manifest } from "../src/app-manifest";

describe("latest policy and turning-point trends versus historical CLI observations", () => {
  it("round trips an explicit latest-data cutoff and preserves zero-valued quarterly survey data", () => {
    const state = {
      ...parseCycleState(
        "?countries=USA&period=2026-07&cycleMetric=loanStandards",
        bundledCycleSnapshot,
      ),
      asOf: "latest" as const,
    };
    expect(cycleTrendEnd(bundledCycleSnapshot, state)).toBe("2026-09");
    expect(
      parseCycleState(
        new URL(cycleViewUrl(state), "https://example.test").search,
        bundledCycleSnapshot,
      ),
    ).toEqual(state);
    expect(manifest.validateSearch({ cycleAsOf: "latest" })).toMatchObject({ cycleAsOf: "latest" });
    expect(manifest.validateSearch({ cycleAsOf: "bad" })).toMatchObject({ cycleAsOf: undefined });
    const csv = cycleCsv(bundledCycleSnapshot, state);
    expect(csv).toContain('"2026-Q3","0","percent","0","percent","Q","NSA"');
    expect(cycleCsv(bundledCycleSnapshot, { ...state, asOf: "period" })).not.toContain('"2026-Q3"');
  });
  it("does not let an explicitly historical month include later quarterly or weekly values", () => {
    const state = parseCycleState(
      "?countries=USA&period=2026-07&cycleMetric=loanStandards",
      bundledCycleSnapshot,
    );
    expect(cycleTrendEnd(bundledCycleSnapshot, state)).toBe("2026-07");
    expect(cycleTableSeries(bundledCycleSnapshot, state)[0]?.points.at(-1)?.period).toBe("2026-Q2");
    const claims = { ...state, metric: "initialClaims" as const, asOf: "latest" as const };
    expect(cycleTrendEnd(bundledCycleSnapshot, claims)).toBe("2026-10");
    expect(cycleCsv(bundledCycleSnapshot, claims)).toContain('"2026-10-17"');
    expect(cycleCsv(bundledCycleSnapshot, { ...claims, asOf: "period" })).not.toContain(
      '"2026-10-17"',
    );
  });
  it("keeps a null tail in the trend horizon so delayed derived readings do not appear fresh", () => {
    const raw = getCycleSeries(bundledCycleSnapshot, "USA", "unemploymentGap")!;
    const snapshot: CycleSnapshot = {
      version: 1,
      fetchedAt: raw.fetchedAt,
      series: [
        {
          ...raw,
          observations: [
            { period: "2025-09", value: 0 },
            { period: "2026-09", value: null },
          ],
        },
      ],
    };
    const state = {
      ...parseCycleState("?countries=USA", bundledCycleSnapshot),
      metric: "unemploymentGap" as const,
      asOf: "latest" as const,
    };
    expect(cycleTrendEnd(snapshot, state)).toBe("2026-09");
    expect(cycleTableSeries(snapshot, state)[0]?.points.at(-1)?.value).toBeNull();
  });
  it("exports original frequency, units, formula and licence links for computed price momentum", () => {
    const state = {
      ...parseCycleState("?countries=USA&cycleMetric=coreInflation3m", bundledCycleSnapshot),
      asOf: "latest" as const,
    };
    const csv = cycleCsv(bundledCycleSnapshot, state);
    const headers = csv.split("\r\n")[0]!;
    expect(headers).toContain('"license_url","note"');
    expect(headers.match(/","/gu)?.length).toBe(16);
    expect(csv).toContain("derived-coreInflation3m");
    expect(csv).toContain("四个连续有效");
    expect(csv).toContain("https://www.bls.gov/bls/linksite.htm");
    expect(csv).toContain('"M","SA"');
  });
});
