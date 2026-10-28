import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchConfidenceSnapshot,
  OECD_CONFIDENCE_URL,
  parseOecdConfidenceCsv,
} from "../src/cycle/oecd-confidence";
import { bundledConfidenceSnapshot } from "../src/cycle/oecd-confidence-snapshot";

const fetchedAt = "2026-10-25T12:00:00Z";
const example = {
  DATAFLOW: "OECD.SDD.STES:DSD_STES@DF_CLI(4.1)",
  REF_AREA: "USA",
  FREQ: "M",
  MEASURE: "BCICP",
  UNIT_MEASURE: "IX",
  ACTIVITY: "_Z",
  ADJUSTMENT: "AA",
  TRANSFORMATION: "IX",
  TIME_HORIZ: "_Z",
  METHODOLOGY: "H",
  TIME_PERIOD: "2026-09",
  OBS_VALUE: "100.3444",
  OBS_STATUS: "A",
  UNIT_MULT: "0",
};
const csv = (rows: Record<string, string>[]) => {
  const columns = Object.keys(rows[0] ?? example);
  const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
  return [
    columns.map(escape).join(","),
    ...rows.map((row) => columns.map((column) => escape(row[column] ?? "")).join(",")),
  ].join("\r\n");
};
const countries = ["CHN", "USA", "JPN", "DEU", "GBR"];
const complete = countries.flatMap((country) =>
  ["BCICP", "CCICP"].flatMap((measure) =>
    Array.from({ length: 12 }, (_, month) => ({
      ...example,
      REF_AREA: country,
      MEASURE: measure,
      TIME_PERIOD: `2025-${String(month + 1).padStart(2, "0")}`,
    })),
  ),
);
afterEach(() => vi.unstubAllGlobals());

describe("OECD harmonised confidence indices", () => {
  it("requires monthly harmonised amplitude-adjusted indices and preserves their source definitions", () => {
    const data = parseOecdConfidenceCsv(csv(complete), fetchedAt);
    expect(data).toHaveLength(10);
    expect(data.every((series) => series.frequency === "M" && series.unit === "index")).toBe(true);
    expect(data.every((series) => series.seasonalAdjustment === "notApplicable")).toBe(true);
    expect(data.every((series) => series.sourceUpdatedAt === null)).toBe(true);
    const business = data.find((series) => series.indicator === "businessConfidence");
    const consumer = data.find((series) => series.indicator === "consumerConfidence");
    expect(business?.note).toContain("仅覆盖制造业");
    expect(business?.note).toContain("100 为长期平均");
    expect(business?.note).toContain("勿将 AA 直接当作 SA");
    expect(consumer?.note).toContain("不是实际消费量");
    expect(consumer?.note).toContain("不是历史实时版本");
    expect(business?.source.seriesCode).toContain(".M.BCICP.IX._Z.AA.IX._Z.H");
    expect(consumer?.source.seriesCode).toContain(".M.CCICP.IX._Z.AA.IX._Z.H");
  });

  it("preserves zero, explicit nulls and source flags without filling missing months", () => {
    const [series] = parseOecdConfidenceCsv(
      csv([
        { ...example, TIME_PERIOD: "2026-01", OBS_VALUE: "0" },
        { ...example, TIME_PERIOD: "2026-03", OBS_VALUE: "", OBS_STATUS: "M" },
        { ...example, TIME_PERIOD: "2026-04", OBS_VALUE: "NA", OBS_STATUS: "L" },
        { ...example, TIME_PERIOD: "2026-05", OBS_VALUE: "99.9", OBS_STATUS: "P" },
      ]),
      fetchedAt,
    );
    expect(series?.observations).toEqual([
      { period: "2026-01", value: 0, status: "A" },
      { period: "2026-03", value: null, status: "M" },
      { period: "2026-04", value: null, status: "L" },
      { period: "2026-05", value: 99.9, status: "P" },
    ]);
  });

  it("discards forecasts and future periods but retains past actual observations", () => {
    const [series] = parseOecdConfidenceCsv(
      csv([
        { ...example, TIME_PERIOD: "2026-07", OBS_STATUS: "P,F" },
        { ...example, TIME_PERIOD: "2026-08", OBS_STATUS: "F" },
        { ...example, TIME_PERIOD: "2026-09", OBS_STATUS: "P" },
        { ...example, TIME_PERIOD: "2026-11" },
        { ...example, TIME_PERIOD: "1999-12" },
      ]),
      fetchedAt,
    );
    expect(series?.observations).toEqual([{ period: "2026-09", value: 100.3444, status: "P" }]);
  });

  it("rejects national raw survey balances, other dimensions and frequency changes", () => {
    for (const mismatch of [
      { DATAFLOW: "OECD.SDD.STES:DSD_STES@DF_BTS(4.0)" },
      { UNIT_MEASURE: "PB" },
      { METHODOLOGY: "N" },
      { ADJUSTMENT: "Y" },
      { FREQ: "Q" },
      { ACTIVITY: "C" },
      { MEASURE: "LI" },
      { TRANSFORMATION: "GY" },
      { TIME_HORIZ: "FT" },
      { REF_AREA: "CAN" },
    ]) {
      expect(() => parseOecdConfidenceCsv(csv([{ ...example, ...mismatch }]), fetchedAt)).toThrow(
        /维度|频率|口径/u,
      );
    }
  });

  it("rejects malformed months, invalid values, scaling changes and missing dimensions", () => {
    for (const period of ["2026-Q1", "2026-00", "2026-13", "2026-09-01"]) {
      expect(() =>
        parseOecdConfidenceCsv(csv([{ ...example, TIME_PERIOD: period }]), fetchedAt),
      ).toThrow(/观测期/u);
    }
    for (const value of ["Infinity", "no value", " "]) {
      expect(() =>
        parseOecdConfidenceCsv(csv([{ ...example, OBS_VALUE: value }]), fetchedAt),
      ).toThrow(/观测值/u);
    }
    expect(() => parseOecdConfidenceCsv(csv([{ ...example, UNIT_MULT: "3" }]), fetchedAt)).toThrow(
      /倍数/u,
    );
    const { METHODOLOGY: _method, ...missing } = example;
    expect(() => parseOecdConfidenceCsv(csv([missing]), fetchedAt)).toThrow(/维度/u);
    expect(() => parseOecdConfidenceCsv(csv([example]), "invalid")).toThrow(/抓取时间/u);
  });

  it("sorts and deduplicates identical observations but rejects conflicting revisions", () => {
    const previous = { ...example, TIME_PERIOD: "2026-08", OBS_VALUE: "100" };
    const [series] = parseOecdConfidenceCsv(csv([example, previous, example]), fetchedAt);
    expect(series?.observations.map((point) => point.period)).toEqual(["2026-08", "2026-09"]);
    expect(() =>
      parseOecdConfidenceCsv(csv([example, { ...example, OBS_VALUE: "101" }]), fetchedAt),
    ).toThrow(/冲突/u);
    expect(() =>
      parseOecdConfidenceCsv(csv([example, { ...example, OBS_STATUS: "P" }]), fetchedAt),
    ).toThrow(/冲突/u);
  });

  it("uses one official batched request and refuses incomplete responses", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(csv(complete)));
    vi.stubGlobal("fetch", fetch);
    const snapshot = await fetchConfidenceSnapshot();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      OECD_CONFIDENCE_URL,
      expect.objectContaining({ headers: { Accept: "text/csv" } }),
    );
    expect(snapshot.series).toHaveLength(10);
    expect(snapshot.series.every((series) => series.fetchedAt === snapshot.fetchedAt)).toBe(true);
    fetch.mockResolvedValue(new Response(csv(complete.filter((row) => row.REF_AREA !== "CHN"))));
    await expect(fetchConfidenceSnapshot()).rejects.toThrow(/覆盖不完整/u);
    fetch.mockResolvedValue(
      new Response(csv(complete.filter((row) => row.TIME_PERIOD === "2025-01"))),
    );
    await expect(fetchConfidenceSnapshot()).rejects.toThrow(/覆盖不完整/u);
  });

  it("does not retry rate limits and passes explicit cancellation to fetch", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("Rate limit", { status: 429 }));
    vi.stubGlobal("fetch", fetch);
    await expect(fetchConfidenceSnapshot()).rejects.toThrow(/HTTP 429/u);
    expect(fetch).toHaveBeenCalledTimes(1);
    const controller = new AbortController();
    controller.abort();
    fetch.mockImplementation(async (_url: string, options: RequestInit) => {
      options.signal?.throwIfAborted();
      return new Response(csv(complete));
    });
    await expect(fetchConfidenceSnapshot(controller.signal)).rejects.toThrow();
  });
});

describe("frozen official OECD confidence resource", () => {
  it("contains both true harmonised indices for all five economies with honest coverage gaps", () => {
    expect(bundledConfidenceSnapshot.version).toBe(1);
    expect(bundledConfidenceSnapshot.series).toHaveLength(10);
    expect(Number.isFinite(Date.parse(bundledConfidenceSnapshot.fetchedAt))).toBe(true);
    for (const country of countries) {
      const series = bundledConfidenceSnapshot.series.filter((item) => item.country === country);
      expect(new Set(series.map((item) => item.indicator))).toEqual(
        new Set(["businessConfidence", "consumerConfidence"]),
      );
      for (const item of series) {
        expect(item.observations.length).toBeGreaterThan(300);
        expect(
          item.observations.every((point) => /^\d{4}-(0[1-9]|1[0-2])$/u.test(point.period)),
        ).toBe(true);
        expect(item.observations.every((point) => point.period <= item.fetchedAt.slice(0, 7))).toBe(
          true,
        );
        expect(
          item.observations.every((point) => point.value === null || Number.isFinite(point.value)),
        ).toBe(true);
        expect(new Set(item.observations.map((point) => point.period)).size).toBe(
          item.observations.length,
        );
        expect(item.sourceUpdatedAt).toBeNull();
        expect(item.unit).toBe("index");
        expect(item.source.url).toMatch(/^https:\/\/sdmx\.oecd\.org\//u);
        expect(item.source.licenseUrl).toBe("https://www.oecd.org/en/about/terms-conditions.html");
        expect(item.note).toContain("非官方译释");
      }
    }
    const chinaBusiness = bundledConfidenceSnapshot.series.find(
      (item) => item.country === "CHN" && item.indicator === "businessConfidence",
    );
    expect(chinaBusiness?.observations[0]?.period).toBe("2000-02");
    const usaBusiness = bundledConfidenceSnapshot.series.find(
      (item) => item.country === "USA" && item.indicator === "businessConfidence",
    );
    expect(usaBusiness?.observations.find((point) => point.period === "2026-09")?.value).toBe(
      100.3444,
    );
  });
});
