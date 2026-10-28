import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FISCAL_DEFINITIONS,
  fetchFiscalDebtSnapshot,
  parseFiscalCountries,
  parseFiscalPayload,
} from "../src/debt/fiscal";
import { bundledFiscalDebtSnapshot, decodeFiscalDebtSnapshot } from "../src/debt/fiscal-snapshot";

const fetchedAt = "2026-10-25T09:00:00.000Z";
const metadata = { page: 1, pages: 1, sourceid: "2", lastupdated: "2026-10-08" };
const row = (
  value: number | null,
  year = "2024",
  code = "GC.XPN.INTP.RV.ZS",
  country = "USA",
  status = "",
) => ({ countryiso3code: country, indicator: { id: code }, date: year, value, obs_status: status });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("official GFS fiscal supplement", () => {
  it("filters official region/income aggregates instead of interpreting their ISO-like IDs as countries", () => {
    expect([
      ...parseFiscalCountries([
        { page: 1, pages: 1 },
        [
          { id: "USA", region: { id: "NAC" } },
          { id: "CHN", region: { id: "EAS" } },
          { id: "HIC", region: { id: "NA" } },
        ],
      ]),
    ]).toEqual(["USA", "CHN"]);
    expect(() => parseFiscalCountries([{ page: 1, pages: 2 }, []])).toThrow();
  });

  it("preserves reported percentages, missing interior years, original status, and a historical latest period", () => {
    const series = parseFiscalPayload(
      [
        metadata,
        [
          row(null, "2025"),
          row(20.29),
          row(null, "2023"),
          row(18, "2022", undefined, undefined, "P"),
          row(8, "2021", undefined, "HIC"),
        ],
      ],
      "GC.XPN.INTP.RV.ZS",
      new Set(["USA"]),
      fetchedAt,
    );
    expect(series).toHaveLength(1);
    expect(series[0]?.observations).toEqual([
      { period: "2022", value: 18, status: "P" },
      { period: "2023", value: null },
      { period: "2024", value: 20.29 },
    ]);
    expect(series[0]?.unit).toBe("percentRevenue");
    expect(series[0]?.currency).toBeNull();
    expect(series[0]?.sourceUpdatedAt).toBe("2026-10-08");
    expect(series[0]?.note).toContain("中央政府");
    expect(series[0]?.note).toContain("不等同 BIS 一般政府");
    expect(series[0]?.note).toContain("不是扣除利息收入后的净利息负担");
  });

  it("retains fiscal-balance sign and does not cap a high interest/revenue ratio", () => {
    const balance = parseFiscalPayload(
      [metadata, [row(-7.18, "2024", "GC.NLD.TOTL.GD.ZS")]],
      "GC.NLD.TOTL.GD.ZS",
      new Set(["USA"]),
      fetchedAt,
    )[0];
    expect(balance?.observations[0]?.value).toBe(-7.18);
    expect(balance?.unit).toBe("percentGdp");
    expect(balance?.note).toContain("净借贷（正）/净借入（负）");
    expect(
      parseFiscalPayload(
        [metadata, [row(120)]],
        "GC.XPN.INTP.RV.ZS",
        new Set(["USA"]),
        fetchedAt,
      )[0]?.observations[0]?.value,
    ).toBe(120);
  });

  it("rejects wrong indicators, future/incomplete years, duplicates, nonfinite values and incomplete pagination", () => {
    const payloads = [
      [metadata, [row(1), row(2)]],
      [metadata, [row(1, "2026")]],
      [metadata, [row(1, "1999")]],
      [metadata, [row(1, "2024", "WRONG")]],
      [metadata, [row(Infinity)]],
      [{ ...metadata, pages: 2 }, [row(1)]],
      [{ ...metadata, lastupdated: "2026-02-30" }, [row(1)]],
    ];
    for (const payload of payloads)
      expect(() =>
        parseFiscalPayload(payload, "GC.XPN.INTP.RV.ZS", new Set(["USA"]), fetchedAt),
      ).toThrow();
  });

  it("does not create a usable series when a country's entire source history is missing", () => {
    expect(
      parseFiscalPayload(
        [metadata, [row(null, "2024", undefined, "CHN")]],
        "GC.XPN.INTP.RV.ZS",
        new Set(["CHN"]),
        fetchedAt,
      ),
    ).toEqual([]);
  });

  it("loads real licensed historical series without a request and distinguishes missing country coverage", () => {
    const network = vi.spyOn(globalThis, "fetch");
    expect(bundledFiscalDebtSnapshot.series).toHaveLength(7);
    expect(new Set(bundledFiscalDebtSnapshot.series.map((series) => series.country))).toEqual(
      new Set(["CHN", "USA", "DEU", "GBR"]),
    );
    const china = bundledFiscalDebtSnapshot.series.find(
      (series) => series.country === "CHN" && series.indicator === "governmentInterestBurden",
    );
    expect(china?.observations.at(-1)?.period).toBe("2021");
    expect(
      bundledFiscalDebtSnapshot.series.some(
        (series) => series.country === "CHN" && series.indicator === "fiscalBalance",
      ),
    ).toBe(false);
    expect(
      bundledFiscalDebtSnapshot.series.every(
        (series) =>
          series.frequency === "A" &&
          series.currency === null &&
          series.source.licenseUrl.includes("cc-by"),
      ),
    ).toBe(true);
    expect(network).not.toHaveBeenCalled();
    expect(() =>
      decodeFiscalDebtSnapshot({
        ...bundledFiscalDebtSnapshot,
        series: [bundledFiscalDebtSnapshot.series[0], bundledFiscalDebtSnapshot.series[0]],
      }),
    ).toThrow();
  });

  it("reproduces the provider from official JSON and honours pre-cancellation", async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (!url.includes("/indicator/"))
        return new Response(
          JSON.stringify([{ page: 1, pages: 1 }, [{ id: "USA", region: { id: "NAC" } }]]),
        );
      const definition = FISCAL_DEFINITIONS.find((item) => url.includes(item.code))!;
      return new Response(JSON.stringify([metadata, [row(4, "2024", definition.code)]]));
    });
    vi.stubGlobal("fetch", fetcher);
    const snapshot = await fetchFiscalDebtSnapshot();
    expect(snapshot.series.map((series) => series.indicator)).toEqual([
      "governmentInterestBurden",
      "fiscalBalance",
    ]);
    expect(fetcher).toHaveBeenCalledTimes(3);
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    await expect(fetchFiscalDebtSnapshot(controller.signal)).rejects.toThrow("cancelled");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
