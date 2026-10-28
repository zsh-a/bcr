import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchUsSignalsSnapshot,
  normalizeUsSignalPeriod,
  parseUsSignalsCsv,
  US_SIGNAL_DEFINITIONS,
  type UsSignalDefinition,
} from "../src/cycle/us-signals";
import {
  bundledUsSignalsSnapshot,
  decodeUsSignalsSnapshot,
} from "../src/cycle/us-signals-snapshot";

const now = new Date("2026-10-25T10:00:00.000Z");
const definition = (code: string): UsSignalDefinition => {
  const item = US_SIGNAL_DEFINITIONS.find((entry) => entry.code === code);
  if (!item) throw new Error(`Test series ${code} not found`);
  return item;
};
const monthly = definition("CPIAUCSL");
const quarterly = definition("DRTSCILM");
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("official US cycle signal observations", () => {
  it("keeps zero, null, negative survey values and reported decimal precision distinct", () => {
    expect(
      parseUsSignalsCsv(
        '\uFEFF"observation_date","DRTSCILM"\r\n"2026-07-01","0.0"\r\n2026-04-01,.\r\n2026-01-01,-12.25\r\n2025-10-01,\r\n',
        quarterly,
        now,
      ),
    ).toEqual([
      { period: "2025-Q4", value: null },
      { period: "2026-Q1", value: -12.25 },
      { period: "2026-Q2", value: null },
      { period: "2026-Q3", value: 0 },
    ]);
    expect(
      parseUsSignalsCsv("DATE,CPIAUCSL\n1999-12-01,100\n2000-01-01,169.300", monthly, now),
    ).toEqual([{ period: "2000-01", value: 169.3 }]);
  });

  it("rejects HTML/errors, another series, duplicate dates, bad numbers and non-native CSV dates", () => {
    const invalid = [
      "<html>blocked</html>",
      "observation_date,CPILFESL\n2026-01-01,1",
      "observation_date,CPIAUCSL\n2026-01-01,1\n2026-01-01,2",
      "observation_date,CPIAUCSL\n2026-01-01,NaN",
      "observation_date,CPIAUCSL\n2026-01-01,Infinity",
      "observation_date,CPIAUCSL\n2026-01-01,0x10",
      "observation_date,CPIAUCSL\n2026-01-01,1e999",
      "observation_date,CPIAUCSL\n2026-01-01,1,000",
      'observation_date,CPIAUCSL\n2026-01-01,"123',
      "observation_date,CPIAUCSL\n2026-01,1",
      "observation_date,CPIAUCSL\n2026-02-30,1",
      "observation_date,CPIAUCSL\n2026-01-02,1",
      "observation_date,CPIAUCSL\n2026-13-01,1",
      "observation_date,CPIAUCSL\n2026-11-01,.",
      "observation_date,CPIAUCSL\n2026-01-01,.",
      "observation_date,CPIAUCSL",
    ];
    for (const csv of invalid) expect(() => parseUsSignalsCsv(csv, monthly, now)).toThrow();
  });

  it("labels quarters from original quarter-start dates and validates stored labels and future quarters", () => {
    expect(normalizeUsSignalPeriod("2026-07-01", "Q", now)).toBe("2026-Q3");
    expect(normalizeUsSignalPeriod("2026-Q4", "Q", now)).toBe("2026-Q4");
    expect(normalizeUsSignalPeriod("2026-10", "M", now)).toBe("2026-10");
    for (const period of ["2026-Q0", "2026-Q5", "2026-Q03", "2026-05-01", "2027-Q1"])
      expect(() => normalizeUsSignalPeriod(period, "Q", now)).toThrow();
    expect(() => normalizeUsSignalPeriod("2026-Q3", "M", now)).toThrow();
    expect(() => normalizeUsSignalPeriod("2026-01", "Q", now)).toThrow();
    expect(() =>
      parseUsSignalsCsv("observation_date,DRTSCILM\n2026-08-01,5", quarterly, now),
    ).toThrow();
  });

  it("uses the verified private final-demand account and preserves different index/rate/annual-level concepts", () => {
    expect(definition("PB0000031Q225SBEA").indicator).toBe("privateDemandGrowth");
    expect(US_SIGNAL_DEFINITIONS.some((item) => item.code === "A261RL1Q225SBEA")).toBe(false);
    const privateDemand = bundledUsSignalsSnapshot.series.find(
      (item) => item.indicator === "privateDemandGrowth",
    );
    expect(privateDemand?.note).toContain("SAAR");
    expect(privateDemand?.source.licenseUrl).toBe("https://www.bea.gov/help/faq/147");
    for (const indicator of ["housingStarts", "buildingPermits"]) {
      const housing = bundledUsSignalsSnapshot.series.find((item) => item.indicator === indicator);
      expect(housing?.unit).toBe("thousandUnits");
      expect(housing?.note).toContain("未除以 12");
      expect(housing?.observations[0]?.value).toBeGreaterThan(1000);
    }
    const core = bundledUsSignalsSnapshot.series.find(
      (item) => item.indicator === "corePriceIndex",
    );
    expect(core?.unit).toBe("index");
    expect(core?.observations[0]?.value).toBe(179.3);
    const standards = bundledUsSignalsSnapshot.series.find(
      (item) => item.indicator === "loanStandards",
    );
    const demand = bundledUsSignalsSnapshot.series.find((item) => item.indicator === "loanDemand");
    expect(standards?.note).toContain("正值表示净收紧");
    expect(demand?.note).toContain("正值表示净增强");
    expect(standards?.observations.some((point) => point.value === 0)).toBe(true);
  });

  it("loads a complete attributed snapshot and retains actual JOLTS and all-employee hours start dates", async () => {
    vi.resetModules();
    const network = vi.spyOn(globalThis, "fetch");
    const { bundledUsSignalsSnapshot: snapshot } = await import("../src/cycle/us-signals-snapshot");
    expect(network).not.toHaveBeenCalled();
    expect(snapshot.series).toHaveLength(12);
    expect(new Set(snapshot.series.map((item) => item.indicator)).size).toBe(12);
    expect(
      snapshot.series.every((item) => item.country === "USA" && item.sourceUpdatedAt === null),
    ).toBe(true);
    expect(
      snapshot.series.reduce((count, item) => count + item.observations.length, 0),
    ).toBeGreaterThan(3000);
    expect(
      snapshot.series.find((item) => item.indicator === "jobOpenings")?.observations[0]?.period,
    ).toBe("2000-12");
    expect(
      snapshot.series.find((item) => item.indicator === "quitsRate")?.observations[0]?.period,
    ).toBe("2000-12");
    expect(
      snapshot.series.find((item) => item.indicator === "weeklyHours")?.observations[0]?.period,
    ).toBe("2006-03");
    expect(
      snapshot.series.every((item) => item.observations.every((point) => point.period >= "2000")),
    ).toBe(true);
  });

  it("rejects corrupted provenance, wrong frequency/units, future labels and duplicated offline data", () => {
    const badSeries: unknown[] = [
      { country: "CHN" },
      { unit: "index" },
      { frequency: "Q" },
      { seasonalAdjustment: "NSA" },
      { sourceUpdatedAt: "2026-10-01" },
      { fetchedAt: "2027-01-01T00:00:00.000Z" },
      { observations: [{ period: "2026-13", value: 1 }] },
      { observations: [{ period: "2027-01", value: null }] },
      { observations: [{ period: "2000-Q1", value: 1 }] },
      { observations: [{ period: "2000-01-01", value: 1 }] },
      { observations: [{ period: "1999-12", value: 1 }] },
      { observations: [{ period: "2000-01", value: NaN }] },
      { observations: [{ period: "2000-01", value: null }] },
      {
        observations: [
          { period: "2000-01", value: 0 },
          { period: "2000-01", value: 1 },
        ],
      },
      { source: { ...bundledUsSignalsSnapshot.series[0]?.source, seriesCode: "JTSJOL" } },
      {
        source: {
          ...bundledUsSignalsSnapshot.series[0]?.source,
          licenseUrl: "https://example.org",
        },
      },
    ];
    for (const patch of badSeries) {
      const value = structuredClone(bundledUsSignalsSnapshot);
      Object.assign(value.series[0]!, patch);
      expect(() => decodeUsSignalsSnapshot(value)).toThrow();
    }
    expect(() => decodeUsSignalsSnapshot({ ...bundledUsSignalsSnapshot, series: [] })).toThrow();
    expect(() =>
      decodeUsSignalsSnapshot(
        { ...bundledUsSignalsSnapshot, fetchedAt: "2027-01-01T00:00:00.000Z" },
        now,
      ),
    ).toThrow();
    const duplicate = structuredClone(bundledUsSignalsSnapshot);
    duplicate.series[1] = duplicate.series[0]!;
    expect(() => decodeUsSignalsSnapshot(duplicate)).toThrow();
  });

  it("refreshes each official native CSV once without converting rates, indexes, or SAAR levels", async () => {
    const fetcher = vi.fn(async (input: string) => {
      const url = new URL(input),
        code = url.searchParams.get("id")!;
      expect(url.origin).toBe("https://fred.stlouisfed.org");
      expect(url.searchParams.get("cosd")).toBe("2000-01-01");
      return new Response(`observation_date,${code}\n2000-01-01,123.456\n2000-04-01,0`);
    });
    vi.stubGlobal("fetch", fetcher);
    const snapshot = await fetchUsSignalsSnapshot();
    expect(fetcher).toHaveBeenCalledTimes(12);
    expect(
      snapshot.series.every(
        (item) => item.observations.map((point) => point.value).join(",") === "123.456,0",
      ),
    ).toBe(true);
    expect(decodeUsSignalsSnapshot(snapshot)).toEqual(snapshot);
    expect(
      snapshot.series
        .filter((item) => item.frequency === "Q")
        .every((item) => item.observations[1]?.period === "2000-Q2"),
    ).toBe(true);
  });

  it("honours pre-cancellation and rejects the whole refresh when a source fails", async () => {
    const fetcher = vi.fn(async (input: string) => {
      const code = new URL(input).searchParams.get("id")!;
      return code === "PERMIT"
        ? new Response("unavailable", { status: 503 })
        : new Response(`observation_date,${code}\n2000-01-01,1`);
    });
    vi.stubGlobal("fetch", fetcher);
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    await expect(fetchUsSignalsSnapshot(controller.signal)).rejects.toThrow("cancelled");
    expect(fetcher).not.toHaveBeenCalled();
    await expect(fetchUsSignalsSnapshot()).rejects.toThrow("FRED PERMIT HTTP 503");
    expect(fetcher).toHaveBeenCalledTimes(12);
  });
});
