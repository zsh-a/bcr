import { afterEach, describe, expect, it, vi } from "vitest";
import { formatMacroValue, getMacroSeries, latestMacroObservation } from "../src/macro/analysis";
import { MACRO_END_YEAR, MACRO_INDICATORS, MACRO_START_YEAR } from "../src/macro/catalog";
import { mergeMacroSnapshots } from "../src/macro/merge";
import type { MacroCountry } from "../src/macro/model";
import {
  bundledMacroSnapshot,
  decodeMacroSnapshot,
  encodeMacroSnapshot,
  parseMacroSnapshot,
} from "../src/macro/snapshot";
import {
  fetchWorldBankSnapshot,
  parseWorldBankCountries,
  parseWorldBankObservations,
  parseWorldBankPage,
} from "../src/macro/worldbank";

const fetchedAt = "2026-10-25T00:00:00.000Z",
  updatedAt = "2026-10-08";
const country: MacroCountry = {
  id: "USA",
  iso2: "US",
  name: "美国",
  englishName: "United States",
  region: "North America",
};
const directory = [
  {
    id: "USA",
    iso2Code: "US",
    name: "United States",
    region: { id: "NAC", value: "North America" },
  },
];
const observation = (year: number, value: unknown) => ({
  countryiso3code: "USA",
  indicator: { id: "NY.GDP.MKTP.KD.ZG" },
  date: String(year),
  value,
});
const makeSnapshot = () =>
  parseWorldBankObservations(
    [observation(2022, 0), observation(2024, 2.5)],
    [country],
    fetchedAt,
    updatedAt,
  );
const response = (rows: unknown[], extra: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify([
      { page: 1, pages: 1, total: rows.length, lastupdated: updatedAt, ...extra },
      rows,
    ]),
    { headers: { "Content-Type": "application/json" } },
  );

afterEach(() => vi.unstubAllGlobals());

describe("macroeconomic annual data semantics", () => {
  it("retains true zero values, fills annual gaps with null and never interpolates", () => {
    const series = getMacroSeries(makeSnapshot(), "USA", "growth");
    expect(series).toHaveLength(46);
    expect(series[0]).toEqual({ year: 1980, value: null });
    expect(series.find((point) => point.year === 2022)?.value).toBe(0);
    expect(series.find((point) => point.year === 2023)?.value).toBeNull();
    expect(series.at(-1)).toEqual({ year: 2025, value: null });
    expect(getMacroSeries(makeSnapshot(), "CHN", "growth")).toEqual([]);
  });

  it("finds the last known observation without relabeling its year", () => {
    const series = getMacroSeries(makeSnapshot(), "USA", "growth");
    expect(latestMacroObservation(series)).toEqual({ year: 2024, value: 2.5 });
    expect(latestMacroObservation(series, 2023)).toEqual({ year: 2022, value: 0 });
    expect(latestMacroObservation(series, 2020)).toBeUndefined();
    expect(latestMacroObservation([...series].reverse())?.year).toBe(2024);
  });

  it("formats actual percentage units and nulls distinctly", () => {
    expect(formatMacroValue(null, "growth")).toBe("—");
    expect(formatMacroValue(Number.NaN, "gdp")).toBe("—");
    expect(formatMacroValue(0, "growth")).toBe("0.0%");
    expect(formatMacroValue(-2.34, "inflation")).toBe("-2.34%");
    expect(formatMacroValue(1.234e12, "gdp")).toBe("$1.23 万亿");
    expect(formatMacroValue(12_345, "gdpPerCapita", false)).toBe("$12,345");
  });

  it("documents the annual CPI, ILO unemployment and current-USD GDP definitions", () => {
    expect(new Set(MACRO_INDICATORS.map((indicator) => indicator.code)).size).toBe(6);
    expect(
      MACRO_INDICATORS.find((indicator) => indicator.id === "inflation")?.description,
    ).toContain("年度");
    expect(
      MACRO_INDICATORS.find((indicator) => indicator.id === "unemployment")?.description,
    ).toContain("ILO");
    expect(MACRO_INDICATORS.find((indicator) => indicator.id === "gdp")?.unit).toBe("usd");
  });
});

describe("World Bank input validation", () => {
  it("filters aggregates while retaining a localized official country catalog", () => {
    expect(
      parseWorldBankCountries([
        ...directory,
        { id: "WLD", iso2Code: "1W", name: "World", region: { id: "NA", value: "Aggregates" } },
      ]),
    ).toEqual([country]);
    expect(() => parseWorldBankCountries([])).toThrow("为空");
    expect(() => parseWorldBankCountries([...directory, ...directory])).toThrow("重复");
  });

  it("rejects error envelopes and malformed paging metadata", () => {
    expect(() => parseWorldBankPage([{ message: [{ id: "120" }] }])).toThrow("分页数据");
    expect(() => parseWorldBankPage([{ page: 1, pages: -1 }, []])).toThrow("分页元数据");
    expect(() => parseWorldBankPage([{ page: 1, pages: 1 }, null])).toThrow();
  });

  it("rejects malformed numbers, missing metadata and duplicate observations", () => {
    expect(() =>
      parseWorldBankObservations([observation(2024, "2.5")], [country], fetchedAt, updatedAt),
    ).toThrow("有效数值");
    expect(() =>
      parseWorldBankObservations([observation(2024, Infinity)], [country], fetchedAt, updatedAt),
    ).toThrow("有效数值");
    expect(() =>
      parseWorldBankObservations([observation(2024, 2)], [country], fetchedAt, ""),
    ).toThrow("来源更新日期");
    expect(() =>
      parseWorldBankObservations(
        [observation(2024, 2), observation(2024, 3)],
        [country],
        fetchedAt,
        updatedAt,
      ),
    ).toThrow("重复观测");
    expect(() =>
      parseWorldBankObservations([observation(2026, 2)], [country], fetchedAt, updatedAt),
    ).toThrow("超出请求范围");
  });

  it("ignores upstream aggregate records with no country ISO3", () => {
    const snapshot = parseWorldBankObservations(
      [
        { countryiso3code: "", date: "2024", value: 1, indicator: { id: "NY.GDP.MKTP.KD.ZG" } },
        observation(2024, 2),
      ],
      [country],
      fetchedAt,
      updatedAt,
    );
    expect(
      getMacroSeries(snapshot, "USA", "growth").find((point) => point.year === 2024)?.value,
    ).toBe(2);
  });

  it("refreshes requested countries only and propagates original source dates", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(directory))
      .mockResolvedValueOnce(response([observation(2024, 2.5)]));
    vi.stubGlobal("fetch", fetcher);
    const snapshot = await fetchWorldBankSnapshot(["usa", "USA"]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1]?.[0]).toContain("/country/USA/indicator/");
    expect(snapshot.countries).toEqual([country]);
    expect(snapshot.sourceUpdatedAt).toBe(updatedAt);
    expect(
      snapshot.series.every(
        (series) => series.sourceUpdatedAt === updatedAt && series.fetchedAt === snapshot.fetchedAt,
      ),
    ).toBe(true);
  });

  it("does not access the network for invalid country selectors", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(fetchWorldBankSnapshot(["USA/../CHN"])).rejects.toThrow("国家代码");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects unavailable services rather than returning synthetic observations", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 503 })));
    await expect(fetchWorldBankSnapshot(["USA"])).rejects.toThrow("HTTP 503");
  });

  it("rejects incomplete observations even when the returned JSON is valid", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(response(directory))
        .mockResolvedValueOnce(response([observation(2024, 2.5)], { total: 2 })),
    );
    await expect(fetchWorldBankSnapshot(["USA"])).rejects.toThrow("观测记录不完整");
  });

  it("rejects total-count changes between pages and incomplete country catalogs", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(response(directory))
        .mockResolvedValueOnce(response([observation(2024, 2.5)], { total: 2, pages: 2 }))
        .mockResolvedValueOnce(response([observation(2023, 2)], { total: 3, pages: 2, page: 2 })),
    );
    await expect(fetchWorldBankSnapshot(["USA"])).rejects.toThrow("分页在下载期间发生变化");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response(directory, { total: 2 })));
    await expect(fetchWorldBankSnapshot(["USA"])).rejects.toThrow("国家目录不完整");
  });

  it("accepts a complete consistent multi-page response", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(response(directory))
        .mockResolvedValueOnce(response([observation(2024, 2.5)], { total: 2, pages: 2 }))
        .mockResolvedValueOnce(response([observation(2023, 2)], { total: 2, pages: 2, page: 2 })),
    );
    const snapshot = await fetchWorldBankSnapshot(["USA"]);
    expect(
      getMacroSeries(snapshot, "USA", "growth").find((point) => point.year === 2023)?.value,
    ).toBe(2);
  });

  it("rejects a multi-page download if the source changes during retrieval", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(response(directory))
        .mockResolvedValueOnce(response([observation(2024, 2)], { pages: 2, total: 2 }))
        .mockResolvedValueOnce(
          response([observation(2023, 3)], {
            pages: 2,
            page: 2,
            total: 2,
            lastupdated: "2026-10-09",
          }),
        ),
    );
    await expect(fetchWorldBankSnapshot(["USA"])).rejects.toThrow("下载期间发生修订");
  });
});

describe("per-series snapshot merge", () => {
  it("keeps newer bundled countries when a recently fetched global cache contains older untouched series", () => {
    const base = makeSnapshot(),
      incoming = makeSnapshot();
    base.sourceUpdatedAt = "2026-10-10";
    base.fetchedAt = "2026-10-20T00:00:00Z";
    base.series = base.series.map((series) => ({
      ...series,
      sourceUpdatedAt: base.sourceUpdatedAt,
      fetchedAt: base.fetchedAt,
    }));
    incoming.fetchedAt = "2026-10-26T00:00:00Z";
    incoming.sourceUpdatedAt = "2026-10-11";
    // The cache refreshed only GDP growth; all its other series still have the older October 8 vintage.
    const recent = incoming.series.find((series) => series.indicator === "growth")!;
    recent.sourceUpdatedAt = incoming.sourceUpdatedAt;
    recent.fetchedAt = incoming.fetchedAt;
    recent.observations.find((point) => point.year === 2024)!.value = 3;
    const merged = mergeMacroSnapshots(base, incoming);
    expect(merged.series.find((series) => series.indicator === "inflation")?.sourceUpdatedAt).toBe(
      "2026-10-10",
    );
    expect(merged.series.find((series) => series.indicator === "growth")?.sourceUpdatedAt).toBe(
      "2026-10-11",
    );
    expect(
      getMacroSeries(merged, "USA", "growth").find((point) => point.year === 2024)?.value,
    ).toBe(3);
    expect(getMacroSeries(base, "USA", "growth").find((point) => point.year === 2024)?.value).toBe(
      2.5,
    );
  });

  it("restores a newer cached series even when a bundle was fetched more recently", () => {
    const base = makeSnapshot(),
      incoming = makeSnapshot();
    base.fetchedAt = "2026-10-30T00:00:00Z";
    base.series = base.series.map((series) => ({ ...series, fetchedAt: base.fetchedAt }));
    incoming.series[0]!.sourceUpdatedAt = "2026-10-09";
    expect(mergeMacroSnapshots(base, incoming).series[0]?.sourceUpdatedAt).toBe("2026-10-09");
  });

  it("uses fetch time only to break source-date ties and allows explicit newer null corrections", () => {
    const base = makeSnapshot(),
      incoming = makeSnapshot();
    incoming.series = incoming.series.filter((series) => series.indicator === "growth");
    incoming.series[0]!.fetchedAt = "2026-10-26T00:00:00Z";
    incoming.series[0]!.observations.find((point) => point.year === 2024)!.value = null;
    const merged = mergeMacroSnapshots(base, incoming);
    expect(merged.series).toHaveLength(6);
    expect(
      getMacroSeries(merged, "USA", "growth").find((point) => point.year === 2024)?.value,
    ).toBeNull();
    expect(merged.series.find((series) => series.indicator === "gdp")?.fetchedAt).toBe(fetchedAt);
  });

  it("materializes legacy per-series provenance and retains new incoming economies", () => {
    const base = makeSnapshot(),
      incoming = makeSnapshot();
    incoming.countries = [{ ...country, id: "CHN", iso2: "CN", name: "中国" }];
    incoming.series = incoming.series.map(
      ({ sourceUpdatedAt: _updated, fetchedAt: _fetched, ...series }) => ({
        ...series,
        country: "CHN",
      }),
    );
    const merged = mergeMacroSnapshots(base, incoming);
    expect(merged.countries.map((item) => item.id)).toEqual(["USA", "CHN"]);
    expect(merged.series).toHaveLength(12);
    expect(
      merged.series
        .filter((series) => series.country === "CHN")
        .every((series) => series.sourceUpdatedAt === updatedAt && series.fetchedAt === fetchedAt),
    ).toBe(true);
  });
});

describe("real frozen snapshot and browser-cache integrity", () => {
  it("decodes a lossless compact snapshot with leading, interior and trailing nulls", () => {
    const original = makeSnapshot(),
      encoded = encodeMacroSnapshot(original),
      decoded = decodeMacroSnapshot(encoded);
    expect(decoded).toEqual(original);
    expect(encoded.series.find((series) => series[1] === "growth")).toEqual([
      "USA",
      "growth",
      2022,
      [0, null, 2.5],
    ]);
    expect(encoded.source).toBe("World Bank: World Development Indicators");
  });

  it("validates browser caches and preserves per-series refresh provenance", () => {
    const snapshot = makeSnapshot();
    snapshot.series[0]!.sourceUpdatedAt = "2026-10-09";
    snapshot.series[0]!.fetchedAt = "2026-10-26T00:00:00Z";
    expect(parseMacroSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot);
    const invalid = JSON.parse(JSON.stringify(snapshot));
    invalid.series[0].observations[0].value = "0";
    expect(() => parseMacroSnapshot(invalid)).toThrow("观测无效");
    delete invalid.sourceUpdatedAt;
    expect(() => parseMacroSnapshot(invalid)).toThrow("元数据无效");
  });

  it("rejects compact snapshots containing incomplete, duplicate or nonfinite series", () => {
    const compact = encodeMacroSnapshot(makeSnapshot());
    expect(() => decodeMacroSnapshot({ ...compact, series: compact.series.slice(1) })).toThrow(
      "缺少",
    );
    expect(() =>
      decodeMacroSnapshot({ ...compact, series: [...compact.series, compact.series[0]] }),
    ).toThrow("重复");
    expect(() =>
      decodeMacroSnapshot({ ...compact, series: [["USA", "growth", 2024, [NaN]]] }),
    ).toThrow("无效");
    expect(() => decodeMacroSnapshot({ ...compact, countries: [] })).toThrow("为空");
  });

  it("ships a global official dataset with explicit coverage and source dates", () => {
    expect(bundledMacroSnapshot.countries.length).toBeGreaterThan(150);
    expect(bundledMacroSnapshot.series).toHaveLength(bundledMacroSnapshot.countries.length * 6);
    expect(bundledMacroSnapshot.sourceUpdatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    expect(bundledMacroSnapshot.countries.some((item) => item.id === "WLD")).toBe(false);
    expect(bundledMacroSnapshot.countries.some((item) => item.id === "CHN")).toBe(true);
    expect(
      bundledMacroSnapshot.series.every(
        (series) =>
          series.observations.length === MACRO_END_YEAR - MACRO_START_YEAR + 1 &&
          series.observations.every(
            (point, index) =>
              point.year === MACRO_START_YEAR + index &&
              (point.value === null || Number.isFinite(point.value)),
          ),
      ),
    ).toBe(true);
    const known = bundledMacroSnapshot.series
      .flatMap((series) => series.observations)
      .filter((point) => point.value !== null);
    expect(known.length).toBeGreaterThan(20_000);
    expect(
      getMacroSeries(bundledMacroSnapshot, "USA", "gdp").find((point) => point.year === 2024)
        ?.value,
    ).toBeGreaterThan(1e13);
  });
});
