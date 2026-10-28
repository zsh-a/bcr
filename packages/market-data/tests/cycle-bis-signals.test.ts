import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BIS_SIGNAL_ACCEPT,
  BIS_SIGNAL_URLS,
  fetchBisSignalsSnapshot,
  parseBisHousePricesCsv,
  parseBisPolicyCsv,
  parseBisSignalsCsv,
} from "../src/cycle/bis-signals";
import { bundledBisSignalsSnapshot } from "../src/cycle/bis-signals-snapshot";

const fetchedAt = "2026-10-25T12:00:00Z";
const policy = {
  DATAFLOW: "BIS:WS_CBPOL(1.0)",
  FREQ: "M",
  REF_AREA: "US",
  TIME_PERIOD: "2026-09",
  OBS_VALUE: "3.875",
  UNIT_MEASURE: "368",
  UNIT_MULT: "0",
  SOURCE_REF: "US Federal Reserve System",
  OBS_STATUS: "A",
  OBS_CONF: "F",
};
const house = {
  DATAFLOW: "BIS:WS_SPP(1.0)",
  FREQ: "Q",
  REF_AREA: "US",
  VALUE: "N",
  UNIT_MEASURE: "771",
  TIME_PERIOD: "2026-Q2",
  OBS_VALUE: "1.1603",
  UNIT_MULT: "0",
  OBS_STATUS: "A",
  OBS_CONF: "F",
};
const csv = (rows: Record<string, string>[]) => {
  const columns = Object.keys(rows[0] ?? policy),
    escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
  return [
    columns.map(escape).join(","),
    ...rows.map((row) => columns.map((column) => escape(row[column] ?? "")).join(",")),
  ].join("\r\n");
};
const policies = ["CN", "US", "JP", "GB", "XM"].map((area) => ({ ...policy, REF_AREA: area }));
const houses = ["CN", "US", "JP", "DE", "GB"].flatMap((area) =>
  ["N", "R"].map((kind) => ({ ...house, REF_AREA: area, VALUE: kind })),
);
const response = (rows: Record<string, string>[]) =>
  new Response(csv(rows), { headers: { "Content-Type": "text/csv" } });
afterEach(() => vi.unstubAllGlobals());

describe("BIS policy reference rates", () => {
  it("uses last-business-day monthly annual rates, not averages or a national German target", () => {
    const data = parseBisPolicyCsv(csv(policies), fetchedAt);
    expect(data).toHaveLength(5);
    expect(
      data.every(
        (series) =>
          series.indicator === "policyRate" &&
          series.frequency === "M" &&
          series.unit === "percent" &&
          series.sourceUpdatedAt === null,
      ),
    ).toBe(true);
    const germany = data.find((series) => series.country === "DEU");
    expect(germany?.source.seriesCode).toBe("BIS:WS_CBPOL(1.0)/M.XM");
    expect(germany?.note).toContain("并非德国独立政策利率");
    expect(germany?.note).toContain("最后一个营业日");
    expect(germany?.note).toContain("2024-09-18");
  });

  it("discloses China's LPR/benchmark break and US range midpoint", () => {
    const data = parseBisPolicyCsv(csv(policies), fetchedAt);
    expect(data.find((series) => series.country === "CHN")?.note).toContain("不是7天逆回购");
    expect(data.find((series) => series.country === "CHN")?.note).toContain("2019-08-20");
    expect(data.find((series) => series.country === "USA")?.note).toContain("区间中点");
  });

  it("preserves zero, negative policy rates, missing values and original source flags", () => {
    const [data] = parseBisPolicyCsv(
      csv([
        { ...policy, TIME_PERIOD: "2026-06", OBS_VALUE: "0" },
        { ...policy, TIME_PERIOD: "2026-07", OBS_VALUE: "-0.1", OBS_STATUS: "B" },
        { ...policy, TIME_PERIOD: "2026-09", OBS_VALUE: "", OBS_STATUS: "M" },
      ]),
      fetchedAt,
    );
    expect(data?.observations).toEqual([
      { period: "2026-06", value: 0, status: "A" },
      { period: "2026-07", value: -0.1, status: "B" },
      { period: "2026-09", value: null, status: "M" },
    ]);
    const ecb = parseBisPolicyCsv(
      csv([{ ...policy, REF_AREA: "XM", TIME_PERIOD: "2024-09", OBS_STATUS: "A" }]),
      fetchedAt,
    )[0];
    expect(ecb?.observations[0]?.status).toBe("A"); // A known tool switch does not invent an official break flag.
  });

  it("does not fill absent Japanese policy periods with zero or stale rates", () => {
    const [data] = parseBisPolicyCsv(
      csv([
        { ...policy, REF_AREA: "JP", TIME_PERIOD: "2013-03", OBS_VALUE: "0.05" },
        { ...policy, REF_AREA: "JP", TIME_PERIOD: "2016-09", OBS_VALUE: "-0.1" },
      ]),
      fetchedAt,
    );
    expect(data?.observations).toHaveLength(2);
    expect(data?.note).toContain("不补零");
  });

  it("refuses daily observations, Germany historical keys and inconsistent units", () => {
    for (const patch of [
      { FREQ: "D" },
      { REF_AREA: "DE" },
      { UNIT_MEASURE: "367" },
      { UNIT_MULT: "3" },
      { TIME_PERIOD: "2026-09-30" },
      { TIME_PERIOD: "2026-13" },
    ])
      expect(() => parseBisPolicyCsv(csv([{ ...policy, ...patch }]), fetchedAt)).toThrow();
  });
});

describe("official selected residential property price growth", () => {
  it("keeps nominal and CPI-deflated real YoY separate without calculating growth twice", () => {
    const data = parseBisHousePricesCsv(
      csv([house, { ...house, VALUE: "R", OBS_VALUE: "-2.6025" }]),
      fetchedAt,
    );
    expect(data.map((series) => series.indicator)).toEqual([
      "nominalHousePrices",
      "realHousePrices",
    ]);
    expect(data.every((series) => series.frequency === "Q" && series.unit === "percent")).toBe(
      true,
    );
    expect(data[1]?.observations[0]?.value).toBe(-2.6025);
    expect(data[1]?.note).toContain("BIS直接发布");
    expect(data[1]?.note).toContain("未自行拼接或重算");
    expect(data[0]?.seasonalAdjustment).toBe("SA");
    expect(data[1]?.seasonalAdjustment).toBe("notApplicable");
  });

  it("documents Chinese 70-city/new-to-existing and Japanese land-to-dwelling breaks", () => {
    const data = parseBisHousePricesCsv(
      csv([
        { ...house, REF_AREA: "CN" },
        { ...house, REF_AREA: "JP" },
      ]),
      fetchedAt,
    );
    expect(data[0]?.note).toContain("70城");
    expect(data[0]?.note).toContain("2016-Q1");
    expect(data[0]?.note).toContain("不是全国全部住宅");
    expect(data[1]?.note).toContain("2008-Q2");
    expect(data[1]?.note).toContain("土地到住宅");
  });

  it("refuses index levels, incorrect regions, nominal/real codes and invalid quarter labels", () => {
    for (const patch of [
      { UNIT_MEASURE: "628" },
      { VALUE: "X" },
      { REF_AREA: "XM" },
      { FREQ: "M" },
      { TIME_PERIOD: "2026-Q5" },
      { TIME_PERIOD: "2026-06" },
    ])
      expect(() => parseBisHousePricesCsv(csv([{ ...house, ...patch }]), fetchedAt)).toThrow();
  });
});

describe("CSV and ingestion boundaries", () => {
  it("deduplicates identical observations and rejects conflicts or malformed responses", () => {
    expect(parseBisPolicyCsv(csv([policy, policy]), fetchedAt)[0]?.observations).toHaveLength(1);
    expect(() =>
      parseBisPolicyCsv(csv([policy, { ...policy, OBS_VALUE: "4" }]), fetchedAt),
    ).toThrow("同期观测冲突");
    expect(() => parseBisSignalsCsv("<html>Access denied</html>")).toThrow("缺少数据维度");
    expect(() => parseBisSignalsCsv(csv([policy]) + '\n"unclosed')).toThrow("引号未闭合");
    expect(
      parseBisSignalsCsv(csv([{ ...policy, TITLE: 'Policy, "reference"' }]))[0]?.["TITLE"],
    ).toBe('Policy, "reference"');
    for (const value of ["Infinity", "NaN1", "0x10", " "])
      expect(() => parseBisPolicyCsv(csv([{ ...policy, OBS_VALUE: value }]), fetchedAt)).toThrow(
        "观测值",
      );
    expect(() => parseBisPolicyCsv(csv([policy]), "2026-02-30T12:00:00Z")).toThrow("抓取日期");
  });

  it("discards forecasts, confidential and not-yet-completed periods but keeps OBS_CONF=F public values", () => {
    const [data] = parseBisPolicyCsv(
      csv([
        policy,
        { ...policy, TIME_PERIOD: "2026-08", OBS_STATUS: "F" },
        { ...policy, TIME_PERIOD: "2026-07", OBS_CONF: "C" },
        { ...policy, TIME_PERIOD: "2026-10" },
        { ...policy, TIME_PERIOD: "2027-01" },
      ]),
      fetchedAt,
    );
    expect(data?.observations).toEqual([{ period: "2026-09", value: 3.875, status: "A" }]);
    expect(parseBisHousePricesCsv(csv([{ ...house, TIME_PERIOD: "2026-Q4" }]), fetchedAt)).toEqual(
      [],
    );
  });

  it("requests two batched official datasets with supported content negotiation", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(policies))
      .mockResolvedValueOnce(response(houses));
    vi.stubGlobal("fetch", fetcher);
    const data = await fetchBisSignalsSnapshot();
    expect(data.series).toHaveLength(15);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[0]).toBe(BIS_SIGNAL_URLS.policy);
    expect(fetcher.mock.calls[0]?.[1].headers.Accept).toBe(BIS_SIGNAL_ACCEPT);
    expect(
      data.series.every(
        (series) => series.fetchedAt === data.fetchedAt && series.sourceUpdatedAt === null,
      ),
    ).toBe(true);
  });

  it("rejects incomplete geographical coverage and propagates source failures without fake data", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(response(policies.filter((row) => row.REF_AREA !== "XM")))
        .mockResolvedValueOnce(response(houses)),
    );
    await expect(fetchBisSignalsSnapshot()).rejects.toThrow("覆盖不完整");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 503 })));
    await expect(fetchBisSignalsSnapshot()).rejects.toThrow("HTTP 503");
  });
});

describe("real frozen BIS policy and housing resource", () => {
  it("contains five monthly policy and ten quarterly housing series with explicit source licensing", () => {
    expect(bundledBisSignalsSnapshot.series).toHaveLength(15);
    expect(
      bundledBisSignalsSnapshot.series.filter((series) => series.indicator === "policyRate"),
    ).toHaveLength(5);
    expect(
      bundledBisSignalsSnapshot.series.filter((series) =>
        ["nominalHousePrices", "realHousePrices"].includes(series.indicator),
      ),
    ).toHaveLength(10);
    expect(
      bundledBisSignalsSnapshot.series.reduce((sum, series) => sum + series.observations.length, 0),
    ).toBeGreaterThan(2400);
    expect(
      bundledBisSignalsSnapshot.series.every(
        (series) =>
          series.sourceUpdatedAt === null &&
          series.source.licenseUrl === "https://data.bis.org/help/legal" &&
          series.source.url.startsWith("https://stats.bis.org/api/v2/") &&
          series.note?.includes("非官方翻译"),
      ),
    ).toBe(true);
    expect(
      bundledBisSignalsSnapshot.series.some((series) => series.indicator === "realPolicyRate"),
    ).toBe(false);
  });

  it("retains original dates and Japanese gaps instead of manufacturing full histories", () => {
    const data = bundledBisSignalsSnapshot.series;
    const japan = data.find(
      (series) => series.country === "JPN" && series.indicator === "policyRate",
    );
    expect(japan?.observations).toHaveLength(215);
    expect(japan?.observations.at(-1)?.period).toBe("2026-09");
    expect(
      data.find((series) => series.country === "CHN" && series.indicator === "nominalHousePrices")
        ?.observations[0]?.period,
    ).toBe("2006-Q2");
    expect(
      data
        .find((series) => series.country === "JPN" && series.indicator === "realHousePrices")
        ?.observations.at(-1)?.period,
    ).toBe("2025-Q4");
    expect(
      data.find((series) => series.country === "DEU" && series.indicator === "policyRate")?.source
        .seriesCode,
    ).toBe("BIS:WS_CBPOL(1.0)/M.XM");
  });
});
