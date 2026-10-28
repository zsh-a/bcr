import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BIS_DEBT_ACCEPT,
  BIS_DEBT_URLS,
  fetchBisDebtSnapshot,
  parseBisCreditCsv,
  parseBisCreditGapCsv,
  parseBisCsv,
  parseBisDebtServiceCsv,
  parseBisPrivateStockCsv,
} from "../src/debt/bis";
import { bundledBisDebtSnapshot } from "../src/debt/bis-snapshot";

const fetchedAt = "2026-10-25T12:00:00Z";
const credit = {
  DATAFLOW: "BIS:WS_TC(2.0)",
  FREQ: "Q",
  BORROWERS_CTY: "US",
  TC_BORROWERS: "P",
  TC_LENDERS: "A",
  VALUATION: "M",
  UNIT_TYPE: "770",
  TC_ADJUST: "A",
  TIME_PERIOD: "2026-Q1",
  OBS_VALUE: "139.7",
  UNIT_MEASURE: "367",
  UNIT_MULT: "0",
  OBS_STATUS: "A",
  OBS_CONF: "F",
};
const service = {
  DATAFLOW: "BIS:WS_DSR(1.0)",
  FREQ: "Q",
  BORROWERS_CTY: "US",
  DSR_BORROWERS: "P",
  TIME_PERIOD: "2026-Q1",
  OBS_VALUE: "14",
  UNIT_MEASURE: "367",
  UNIT_MULT: "0",
  OBS_STATUS: "A",
  OBS_CONF: "F",
};
const gap = {
  DATAFLOW: "BIS:WS_CREDIT_GAP(1.0)",
  FREQ: "Q",
  BORROWERS_CTY: "US",
  TC_BORROWERS: "P",
  TC_LENDERS: "A",
  CG_DTYPE: "C",
  TIME_PERIOD: "2026-Q1",
  OBS_VALUE: "-5.6",
  UNIT_MEASURE: "770",
  UNIT_MULT: "0",
  OBS_STATUS: "A",
  OBS_CONF: "F",
};
const csv = (rows: Record<string, string>[]) => {
  const columns = Object.keys(rows[0] ?? credit);
  const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
  return [
    columns.map(escape).join(","),
    ...rows.map((row) => columns.map((key) => escape(row[key] ?? "")).join(",")),
  ].join("\r\n");
};
const countries = ["CN", "US", "JP", "DE", "GB"];
const fullCredit = countries.flatMap((country) =>
  ["H", "N", "G", "P"].map((sector) => ({
    ...credit,
    BORROWERS_CTY: country,
    TC_BORROWERS: sector,
    VALUATION: sector === "G" ? "N" : "M",
  })),
);
const currencies: Readonly<Record<string, string>> = {
  CN: "CNY",
  US: "USD",
  JP: "JPY",
  DE: "EUR",
  GB: "GBP",
};
const fullStock = countries.map((country) => ({
  ...credit,
  BORROWERS_CTY: country,
  UNIT_TYPE: "XDC",
  UNIT_MEASURE: currencies[country] ?? "",
  UNIT_MULT: "9",
  OBS_VALUE: "12345.678",
}));
const fullService = countries.map((country) => ({ ...service, BORROWERS_CTY: country }));
const fullGap = countries.map((country) => ({ ...gap, BORROWERS_CTY: country }));
const response = (rows: Record<string, string>[]) =>
  new Response(csv(rows), { headers: { "Content-Type": "text/csv" } });
afterEach(() => vi.unstubAllGlobals());

describe("BIS credit definitions and values", () => {
  it("maps four borrowing sectors with correct units, valuation and NSA break adjustment", () => {
    const series = parseBisCreditCsv(
      csv(fullCredit.filter((row) => row.BORROWERS_CTY === "US")),
      fetchedAt,
    );
    expect(series.map((item) => item.indicator)).toEqual([
      "householdDebt",
      "corporateDebt",
      "governmentDebt",
      "privateDebt",
    ]);
    expect(
      series.every(
        (item) =>
          item.unit === "percentGdp" &&
          item.seasonalAdjustment === "NSA" &&
          item.currency === null &&
          item.sourceUpdatedAt === null,
      ),
    ).toBe(true);
    expect(series.find((item) => item.indicator === "corporateDebt")?.note).toContain(
      "包括公共和私人",
    );
    expect(series.find((item) => item.indicator === "governmentDebt")?.valuation).toBe("nominal");
    expect(series.find((item) => item.indicator === "privateDebt")?.note).toContain(
      "并非纯民营口径",
    );
  });

  it("prefers a complete nominal government series without splicing older market observations", () => {
    const series = parseBisCreditCsv(
      csv([
        { ...credit, TC_BORROWERS: "G", TIME_PERIOD: "1990-Q1", OBS_VALUE: "40" },
        { ...credit, TC_BORROWERS: "G", TIME_PERIOD: "2000-Q1", OBS_VALUE: "50" },
        { ...credit, TC_BORROWERS: "G", VALUATION: "N", TIME_PERIOD: "2000-Q1", OBS_VALUE: "55" },
      ]),
      fetchedAt,
    );
    expect(series).toHaveLength(1);
    expect(series[0]?.valuation).toBe("nominal");
    expect(series[0]?.source.seriesCode).toContain(".G.A.N.770.A");
    expect(series[0]?.observations).toEqual([{ period: "2000-Q1", value: 55, status: "A" }]);
  });

  it("uses a labeled market fallback if a nominal government candidate is entirely missing", () => {
    const [series] = parseBisCreditCsv(
      csv([
        { ...credit, TC_BORROWERS: "G", VALUATION: "N", OBS_VALUE: "" },
        { ...credit, TC_BORROWERS: "G", VALUATION: "M", OBS_VALUE: "55" },
      ]),
      fetchedAt,
    );
    expect(series?.valuation).toBe("market");
    expect(series?.note).toContain("无可用的非空名义序列");
  });

  it("preserves true zero and missing values without interpolation or copying another sector", () => {
    const [series] = parseBisCreditCsv(
      csv([
        { ...credit, TIME_PERIOD: "2025-Q3", OBS_VALUE: "0" },
        { ...credit, TIME_PERIOD: "2026-Q1", OBS_VALUE: "", OBS_STATUS: "M" },
      ]),
      fetchedAt,
    );
    expect(series?.observations).toEqual([
      { period: "2025-Q3", value: 0, status: "A" },
      { period: "2026-Q1", value: null, status: "M" },
    ]);
  });

  it("keeps public values marked OBS_CONF=F but excludes forecasts and confidential observations", () => {
    const [series] = parseBisCreditCsv(
      csv([
        credit,
        { ...credit, TIME_PERIOD: "2025-Q4", OBS_STATUS: "F" },
        { ...credit, TIME_PERIOD: "2025-Q3", OBS_CONF: "C" },
        { ...credit, TIME_PERIOD: "2026-Q4" },
      ]),
      fetchedAt,
    );
    expect(series?.observations).toEqual([{ period: "2026-Q1", value: 139.7, status: "A" }]);
  });

  it("rejects wrong frequencies, units, domestic-bank lending and unadjusted credit", () => {
    for (const patch of [
      { FREQ: "A" },
      { UNIT_TYPE: "771" },
      { UNIT_MEASURE: "770" },
      { UNIT_MULT: "3" },
      { TC_LENDERS: "B" },
      { TC_ADJUST: "U" },
      { VALUATION: "X" },
    ])
      expect(() => parseBisCreditCsv(csv([{ ...credit, ...patch }]), fetchedAt)).toThrow();
    for (const period of ["2026Q1", "Q2026", "2026-Q0", "2026-Q5", "2026-03"])
      expect(() => parseBisCreditCsv(csv([{ ...credit, TIME_PERIOD: period }]), fetchedAt)).toThrow(
        "季度日期",
      );
  });

  it("deduplicates identical records, rejects conflicts and validates numeric/metadata dates", () => {
    expect(parseBisCreditCsv(csv([credit, credit]), fetchedAt)[0]?.observations).toHaveLength(1);
    expect(() =>
      parseBisCreditCsv(csv([credit, { ...credit, OBS_VALUE: "140" }]), fetchedAt),
    ).toThrow("同期观测冲突");
    for (const value of ["Infinity", "1x", "0x10", " "])
      expect(() => parseBisCreditCsv(csv([{ ...credit, OBS_VALUE: value }]), fetchedAt)).toThrow(
        "观测值",
      );
    expect(() => parseBisCreditCsv(csv([credit]), "2026-02-30T12:00:00Z")).toThrow("抓取时间");
  });
});

describe("original BIS local-currency credit stocks", () => {
  it("retains original billion-local values and all five currencies separately", () => {
    const values = parseBisPrivateStockCsv(csv(fullStock), fetchedAt);
    expect(values).toHaveLength(5);
    expect(values.map((item) => item.currency)).toEqual(["CNY", "USD", "JPY", "EUR", "GBP"]);
    expect(
      values.every(
        (item) =>
          item.indicator === "privateCreditStock" &&
          item.unit === "billionLocal" &&
          item.valuation === "market" &&
          item.seasonalAdjustment === "NSA",
      ),
    ).toBe(true);
    expect(values[0]?.observations[0]?.value).toBe(12345.678);
    expect(values[0]?.note).toContain("不同本币金额不能直接跨国比较");
    expect(values[0]?.source.seriesCode).toContain(".XDC.A");
  });

  it("rejects wrong currency, multiplier, bank-only scope and debt/GDP disguised as a stock", () => {
    const row = fullStock[0]!;
    for (const patch of [
      { UNIT_MULT: "0" },
      { UNIT_MEASURE: "USD" },
      { UNIT_TYPE: "770" },
      { TC_LENDERS: "B" },
    ])
      expect(() => parseBisPrivateStockCsv(csv([{ ...row, ...patch }]), fetchedAt)).toThrow();
  });

  it("ships continuous original XDC histories without deriving a synthetic credit impulse", () => {
    const values = bundledBisDebtSnapshot.series.filter(
      (item) => item.indicator === "privateCreditStock",
    );
    expect(values).toHaveLength(5);
    expect(
      values.every(
        (item) =>
          item.observations.length === 145 &&
          item.observations[0]?.period === "1990-Q1" &&
          item.observations.at(-1)?.period === "2026-Q1",
      ),
    ).toBe(true);
    expect(values.find((item) => item.country === "CHN")?.observations.at(-1)?.value).toBe(
      289406.889,
    );
  });
});

describe("official DSR and credit gap semantics", () => {
  it("separates private, household and corporate income debt-service ratios", () => {
    const data = parseBisDebtServiceCsv(
      csv(["P", "H", "N"].map((sector) => ({ ...service, DSR_BORROWERS: sector }))),
      fetchedAt,
    );
    expect(data.map((item) => item.indicator)).toEqual([
      "debtService",
      "householdDebtService",
      "corporateDebtService",
    ]);
    expect(
      data.every(
        (item) =>
          item.unit === "percentIncome" &&
          item.valuation === "notApplicable" &&
          item.note.includes("不应用于跨国绝对水平排名"),
      ),
    ).toBe(true);
    expect(data.find((item) => item.indicator === "corporateDebtService")?.note).toContain(
      "含公共和私人企业",
    );
  });

  it("retains negative gaps as percentage points and refuses ratios/trend masquerading as gaps", () => {
    const [series] = parseBisCreditGapCsv(csv([gap]), fetchedAt);
    expect(series?.unit).toBe("percentagePoints");
    expect(series?.observations[0]?.value).toBe(-5.6);
    expect(series?.note).toContain("单边HP");
    for (const type of ["A", "B"])
      expect(() => parseBisCreditGapCsv(csv([{ ...gap, CG_DTYPE: type }]), fetchedAt)).toThrow(
        "实际值减趋势",
      );
  });

  it("rejects malformed CSV/error pages instead of treating them as a dataset", () => {
    expect(() => parseBisCsv("<html>Access denied</html>", [])).toThrow("缺少数据维度");
    expect(() => parseBisCsv(csv([credit]) + '\n"unclosed', [])).toThrow("引号未闭合");
    expect(
      parseBisCsv(csv([{ ...credit, TITLE_TS: 'Credit, "all sectors"' }]), [])[0]?.["TITLE_TS"],
    ).toBe('Credit, "all sectors"');
  });
});

describe("BIS explicit ingestion", () => {
  it("requests four batched queries for three official flows with supported CSV content negotiation", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(fullCredit))
      .mockResolvedValueOnce(response(fullStock))
      .mockResolvedValueOnce(response(fullService))
      .mockResolvedValueOnce(response(fullGap));
    vi.stubGlobal("fetch", fetcher);
    const snapshot = await fetchBisDebtSnapshot();
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
      BIS_DEBT_URLS.credit,
      BIS_DEBT_URLS.stock,
      BIS_DEBT_URLS.service,
      BIS_DEBT_URLS.gap,
    ]);
    expect(fetcher.mock.calls[0]?.[1].headers.Accept).toBe(BIS_DEBT_ACCEPT);
    expect(snapshot.series).toHaveLength(35);
    expect(
      snapshot.series.every(
        (item) => item.sourceUpdatedAt === null && item.fetchedAt === snapshot.fetchedAt,
      ),
    ).toBe(true);
  });

  it("does not overwrite data with an incomplete country set or fabricate results after API failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(response(fullCredit.filter((row) => row.BORROWERS_CTY !== "CN")))
        .mockResolvedValueOnce(response(fullStock))
        .mockResolvedValueOnce(response(fullService))
        .mockResolvedValueOnce(response(fullGap)),
    );
    await expect(fetchBisDebtSnapshot()).rejects.toThrow("覆盖不完整");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 503 })));
    await expect(fetchBisDebtSnapshot()).rejects.toThrow("HTTP 503");
  });
});

describe("frozen original BIS dataset coverage", () => {
  it("contains real quarter observations and source-specific units without synthetic growth/impulse", () => {
    const snapshot = bundledBisDebtSnapshot;
    expect(snapshot.series).toHaveLength(43);
    expect(
      snapshot.series.reduce((sum, item) => sum + item.observations.length, 0),
    ).toBeGreaterThan(4500);
    expect(
      snapshot.series.every(
        (item) =>
          item.frequency === "Q" &&
          item.source.licenseUrl === "https://data.bis.org/help/legal" &&
          item.source.url.startsWith("https://stats.bis.org/api/v2/") &&
          item.sourceUpdatedAt === null &&
          item.observations.every(
            (point) =>
              /^\d{4}-Q[1-4]$/u.test(point.period) &&
              (point.value === null || Number.isFinite(point.value)),
          ),
      ),
    ).toBe(true);
    expect(
      snapshot.series.some((item) => ["creditImpulse", "creditGrowth"].includes(item.indicator)),
    ).toBe(false);
    expect(
      snapshot.series
        .find((item) => item.country === "CHN" && item.indicator === "privateDebt")
        ?.observations.at(-1),
    ).toEqual({ period: "2026-Q1", value: 204.1, status: "A" });
  });

  it("retains country-specific historical gaps and nominal-government coverage", () => {
    const snapshot = bundledBisDebtSnapshot;
    expect(
      snapshot.series.find((item) => item.country === "CHN" && item.indicator === "householdDebt")
        ?.observations[0]?.period,
    ).toBe("2006-Q1");
    expect(
      snapshot.series.find((item) => item.country === "DEU" && item.indicator === "governmentDebt")
        ?.observations[0]?.period,
    ).toBe("2000-Q1");
    expect(
      snapshot.series
        .filter((item) => item.indicator === "governmentDebt")
        .every((item) => item.valuation === "nominal"),
    ).toBe(true);
    expect(
      snapshot.series.some(
        (item) =>
          item.country === "CHN" &&
          ["householdDebtService", "corporateDebtService"].includes(item.indicator),
      ),
    ).toBe(false);
    expect(
      snapshot.series.find((item) => item.country === "CHN" && item.indicator === "creditGap")
        ?.observations[0]?.period,
    ).toBe("1995-Q4");
  });
});
