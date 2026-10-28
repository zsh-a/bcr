import { describe, expect, it, vi } from "vitest";
import {
  bundledEconomicRepository,
  createEconomicRepository,
  economicCsv,
  economicPeriodEnd,
  formatEconomicValue,
  queryEconomicTracks,
} from "../src/economy";
import type { MacroSnapshot } from "../src/macro/model";
import type { CycleSeries, CycleSnapshot } from "../src/cycle/model";
import type { DebtSeries } from "../src/debt/model";

const fetchedAt = "2026-10-25T12:00:00Z";
const china = { id: "CHN", iso2: "CN", name: "中国", englishName: "China", region: "东亚" };
const annual: MacroSnapshot = {
  version: 1,
  fetchedAt,
  sourceUpdatedAt: "2026-10-20",
  countries: [china],
  series: [
    {
      country: "CHN",
      indicator: "inflation",
      fetchedAt: "2026-10-21T00:00:00Z",
      sourceUpdatedAt: "2026-10-19",
      observations: [
        { year: 2023, value: 0 },
        { year: 2024, value: 2.5 },
      ],
    },
  ],
};
const cycleBase: CycleSeries = {
  country: "CHN",
  indicator: "inflation",
  frequency: "M",
  unit: "percent",
  seasonalAdjustment: "NSA",
  source: {
    name: "NBS",
    url: "https://www.stats.gov.cn/",
    seriesCode: "MONTHLY.CPI",
    licenseUrl: "https://www.stats.gov.cn/license",
  },
  fetchedAt,
  sourceUpdatedAt: null,
  note: "当月同比，不是年度变化率。",
  observations: [
    { period: "2024-01", value: 0, status: "A" },
    { period: "2024-02", value: -0.5, status: "P" },
  ],
};
const cycle = (...series: CycleSeries[]): CycleSnapshot => ({ version: 1, fetchedAt, series });
const query = {
  metricId: "cycle:inflation",
  countries: ["CHN"],
  range: ["2023-01-01", "2024-12-31"] as [string, string],
  cutoff: "2024-12-31",
};

describe("unified economic adapters and catalogue", () => {
  it("keeps annual and monthly inflation separate with native dates and per-series provenance", () => {
    const repository = createEconomicRepository({ annual, cycle: cycle(cycleBase), debt: null });
    const yearly = repository.getSeries("CHN", "annual:inflation")!;
    const monthly = repository.getSeries("CHN", "cycle:inflation")!;
    expect(repository.metrics.map((metric) => metric.id)).toEqual([
      "annual:inflation",
      "cycle:inflation",
    ]);
    expect(yearly.id).not.toBe(monthly.id);
    expect(yearly.frequency).toBe("A");
    expect(yearly.observations[0]).toEqual({
      period: "2023",
      date: "2023-12-31",
      value: 0,
      rawValue: 0,
    });
    expect(monthly.observations[0]?.date).toBe("2024-01-31");
    expect(yearly.sourceUpdatedAt).toBe("2026-10-19");
    expect(yearly.fetchedAt).toBe("2026-10-21T00:00:00Z");
    expect(monthly.sourceUpdatedAt).toBeNull();
    expect(yearly.note).toContain("年度指标");
    expect(yearly.note).toContain("不是各历史年度的首次发布日期");
    expect(yearly.source.url).toBe(
      "https://databank.worldbank.org/source/world-development-indicators",
    );
    const cutoff = { ...query, cutoff: "2024-02-29" };
    expect(
      queryEconomicTracks(repository, { ...cutoff, metricId: "annual:inflation" })[0]?.points.map(
        (point) => point.period,
      ),
    ).toEqual(["2023"]);
    expect(queryEconomicTracks(repository, cutoff)[0]?.points.map((point) => point.period)).toEqual(
      ["2024-01", "2024-02"],
    );
  });

  it("reuses existing cycle display calculations while retaining raw levels and flagging computed output", () => {
    const source: CycleSeries = {
      ...cycleBase,
      indicator: "industrialProduction",
      unit: "index",
      seasonalAdjustment: "SA",
      observations: [
        { period: "2023-01", value: 100 },
        { period: "2024-01", value: 110, status: "P" },
        { period: "2024-02", value: 121 },
      ],
    };
    const repository = createEconomicRepository({ annual: null, cycle: cycle(source), debt: null });
    const item = repository.getSeries("CHN", "cycle:industrialProduction")!;
    expect(item.unit).toBe("percent");
    expect(item.rawUnit).toBe("index");
    expect(item.computed).toBe(true);
    expect(item.observations[1]?.value).toBeCloseTo(10);
    expect(item.observations[1]).toMatchObject({ rawValue: 110, status: "P" });
    expect(item.observations[2]).toMatchObject({ value: null, rawValue: 121 });
    expect(item.note).toContain("展示计算值");
    const direct = createEconomicRepository({
      annual: null,
      cycle: cycle({ ...source, unit: "percent" }),
      debt: null,
    }).series[0]!;
    expect(direct.computed).toBe(false);
    expect(direct.observations[1]?.value).toBe(110);
  });

  it("retains debt currency, valuation, source and existing derived identity without recomputing it", () => {
    const debt: DebtSeries = {
      country: "USA",
      indicator: "privateCreditStock",
      frequency: "Q",
      unit: "billionLocal",
      currency: "USD",
      seasonalAdjustment: "NSA",
      valuation: "nominal",
      source: {
        name: "BIS",
        url: "https://data.bis.org/",
        seriesCode: "Q.US.P.A.M.XDC.A",
        licenseUrl: "https://data.bis.org/help/legal",
      },
      fetchedAt,
      sourceUpdatedAt: null,
      note: "本币断点调整余额。",
      observations: [{ period: "2024-Q1", value: 0 }],
    };
    const derived: DebtSeries = {
      ...debt,
      indicator: "creditGrowth",
      unit: "percent",
      currency: null,
      valuation: "notApplicable",
      source: { ...debt.source, seriesCode: `${debt.source.seriesCode}/derived-yoy-4q` },
      note: "计算值：四季同比。",
      observations: [{ period: "2024-Q1", value: -2, status: "derived:A" }],
    };
    const repository = createEconomicRepository({
      annual: null,
      cycle: null,
      debt: { version: 1, fetchedAt, series: [debt, derived] },
    });
    const raw = repository.getSeries("USA", "debt:privateCreditStock")!;
    expect(raw).toMatchObject({
      currency: "USD",
      valuation: "nominal",
      computed: false,
      unit: "billionLocal",
    });
    expect(raw.observations[0]).toEqual({
      period: "2024-Q1",
      date: "2024-03-31",
      value: 0,
      rawValue: 0,
    });
    const result = repository.getSeries("USA", "debt:creditGrowth")!;
    expect(result.computed).toBe(true);
    expect(result.observations[0]).toMatchObject({ value: -2, rawValue: -2, status: "derived:A" });
    expect(decodeURIComponent(raw.id)).toContain("Q.US.P.A.M.XDC.A/Q/NSA/billionLocal/USD/nominal");
  });

  it("builds country coverage from actual series, keeps stable IDs and does not mutate source snapshots", () => {
    const input = cycle({ ...cycleBase, observations: [...cycleBase.observations].reverse() });
    const before = JSON.stringify(input);
    const repository = createEconomicRepository({ annual: null, cycle: input, debt: null });
    expect(repository.countries.map((country) => country.id)).toEqual(["CHN"]);
    expect(repository.metrics[0]?.countries).toEqual(["CHN"]);
    expect(repository.getSeries("USA", "cycle:inflation")).toBeUndefined();
    expect(repository.minDate).toBe("2024-01-31");
    expect(repository.maxDate).toBe("2024-02-29");
    expect(JSON.stringify(input)).toBe(before);
    expect(createEconomicRepository({ annual: null, cycle: input, debt: null }).series[0]?.id).toBe(
      repository.series[0]?.id,
    );
    expect(() =>
      createEconomicRepository({ annual: null, cycle: cycle(cycleBase, cycleBase), debt: null }),
    ).toThrow(/重复国家/u);
  });

  it("rejects duplicate periods or invalid native dates without turning malformed values into zero", () => {
    for (const observations of [
      [
        { period: "2024-01", value: 1 },
        { period: "2024-01", value: 1 },
      ],
      [{ period: "2024-13", value: 1 }],
      [{ period: "2024-01", value: Number.NaN }],
    ])
      expect(() =>
        createEconomicRepository({
          annual: null,
          cycle: cycle({ ...cycleBase, observations }),
          debt: null,
        }),
      ).toThrow();
  });

  it("uses frozen resources without fetch and supplies honest baseline and theme metadata", () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    try {
      const repository = createEconomicRepository();
      expect(fetch).not.toHaveBeenCalled();
      expect(repository.series.length).toBeGreaterThan(1400);
      expect(repository.countries.length).toBeGreaterThan(200);
      const definitions = new Map(repository.metrics.map((metric) => [metric.id, metric]));
      expect(definitions.get("cycle:cli")).toMatchObject({ baseline: 100, theme: "confidence" });
      expect(definitions.get("cycle:businessConfidence")?.baseline).toBe(100);
      expect(definitions.get("cycle:consumerConfidence")?.baseline).toBe(100);
      expect(definitions.get("cycle:pmiManufacturing")?.baseline).toBe(50);
      expect(definitions.get("annual:gdp")).toMatchObject({ baseline: null, theme: "growth" });
      expect(definitions.get("debt:creditGap")).toMatchObject({ baseline: 0, theme: "credit" });
      expect(definitions.get("cycle:unemployment")?.theme).toBe("labor");
      expect(new Set(repository.series.map((item) => item.id)).size).toBe(repository.series.length);
      expect(bundledEconomicRepository.metrics.map((metric) => metric.id)).toEqual(
        repository.metrics.map((metric) => metric.id),
      );
    } finally {
      fetch.mockRestore();
    }
  });
});

describe("native dates, units and source-preserving CSV", () => {
  it("returns valid calendar period ends including leap years and preserves actual weekly/daily dates", () => {
    expect(economicPeriodEnd("2024", "A")).toBe("2024-12-31");
    expect(economicPeriodEnd("2024-Q1", "Q")).toBe("2024-03-31");
    expect(economicPeriodEnd("2024-02", "M")).toBe("2024-02-29");
    expect(economicPeriodEnd("2023-02", "M")).toBe("2023-02-28");
    expect(economicPeriodEnd("2024-02-29", "W")).toBe("2024-02-29");
    expect(economicPeriodEnd("2024-02-29", "D")).toBe("2024-02-29");
    for (const period of ["2024-02-30", "2023-02-29", "2024-2-01"])
      expect(() => economicPeriodEnd(period, "D")).toThrow();
    expect(() => economicPeriodEnd("2024-Q5", "Q")).toThrow();
    expect(() => economicPeriodEnd("2024-01", "A")).toThrow();
  });

  it("formats every current unit, preserving ratio denominators and original local-currency scales", () => {
    expect(formatEconomicValue(null, "percent")).toBe("—");
    expect(formatEconomicValue(Number.NaN, "index")).toBe("—");
    expect(formatEconomicValue(0, "percent")).toBe("0%");
    expect(formatEconomicValue(-1.5, "percentagePoints")).toBe("-1.5 个百分点");
    expect(formatEconomicValue(125, "percentGdp")).toBe("125% GDP");
    expect(formatEconomicValue(12, "percentIncome")).toBe("12% 收入");
    expect(formatEconomicValue(3, "percentRevenue")).toBe("3% 财政收入");
    expect(formatEconomicValue(2, "billionLocal", "JPY")).toBe("2 十亿日元");
    expect(formatEconomicValue(2, "trillionLocal", "CNY")).toBe("2 万亿人民币");
    expect(formatEconomicValue(2, "billionLocal")).toContain("币种未提供");
    expect(formatEconomicValue(1e12, "usd")).toContain("美元");
    for (const unit of [
      "index",
      "persons",
      "thousandPersons",
      "billionsUsd",
      "thousandUnits",
      "hours",
      "ratio",
    ])
      expect(formatEconomicValue(1, unit)).not.toMatch(/undefined|NaN/u);
  });

  it("exports only native points with nulls empty, zero intact, raw/display units and complete provenance", () => {
    const source: CycleSeries = {
      ...cycleBase,
      indicator: "industrialProduction",
      unit: "index",
      note: '说明含逗号,与"引号"\n换行',
      observations: [
        { period: "2023-01", value: 100 },
        { period: "2024-01", value: 100 },
        { period: "2024-03", value: null },
      ],
    };
    const repository = createEconomicRepository({ annual: null, cycle: cycle(source), debt: null });
    const tracks = queryEconomicTracks(repository, {
      ...query,
      metricId: "cycle:industrialProduction",
      range: ["2024-01-01", "2024-03-31"],
    });
    expect(tracks[0]?.points).toHaveLength(2);
    expect(tracks[0]?.plot).toHaveLength(3);
    const output = economicCsv(tracks);
    expect(output.startsWith("\uFEFF")).toBe(true);
    expect(output).toContain('"2024-01","2024-01-31","0","percent","100","index","M","NSA"');
    expect(output).toContain('"2024-03","2024-03-31","","percent","","index"');
    expect(output).not.toContain('"2024-02","2024-02-29"');
    expect(output).toContain('"source_updated_at","fetched_at","license_url","note"');
    expect(output).toContain('"true","NBS","MONTHLY.CPI","https://www.stats.gov.cn/",""');
    expect(output).toContain('与""引号""\n换行');
    expect(output).toContain('"https://www.stats.gov.cn/license"');
  });
});
