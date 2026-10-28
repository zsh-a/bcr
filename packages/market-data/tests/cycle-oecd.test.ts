import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHINA_PMI_SOURCE_URL,
  fetchChinaCycleSnapshot,
  parseChinaPmiHtml,
} from "../src/cycle/china";
import { bundledChinaSnapshot } from "../src/cycle/china-snapshot";
import {
  fetchOecdCycleSnapshot,
  OECD_CLI_URL,
  OECD_KEI_URL,
  parseOecdCliCsv,
  parseOecdCoreCsv,
  parseOecdJapanPricesCsv,
  parseOecdCsv,
  parseOecdKeiCsv,
} from "../src/cycle/oecd";
import { bundledOecdSnapshot } from "../src/cycle/oecd-snapshot";

const fetchedAt = "2026-10-25T12:00:00Z";
const cli = {
  DATAFLOW: "OECD.SDD.STES:DSD_STES@DF_CLI(4.1)",
  REF_AREA: "USA",
  FREQ: "M",
  MEASURE: "LI",
  UNIT_MEASURE: "IX",
  ACTIVITY: "_Z",
  ADJUSTMENT: "AA",
  TRANSFORMATION: "IX",
  TIME_HORIZ: "_Z",
  METHODOLOGY: "H",
  TIME_PERIOD: "2026-09",
  OBS_VALUE: "100.5",
  OBS_STATUS: "A",
  UNIT_MULT: "0",
};
const kei = {
  DATAFLOW: "OECD.SDD.STES:DSD_KEI@DF_KEI(4.0)",
  REF_AREA: "USA",
  FREQ: "M",
  MEASURE: "CP",
  UNIT_MEASURE: "GR",
  ACTIVITY: "_Z",
  ADJUSTMENT: "_Z",
  TRANSFORMATION: "GY",
  TIME_PERIOD: "2026-09",
  OBS_VALUE: "3.5",
  OBS_STATUS: "A",
  UNIT_MULT: "0",
};
const csv = (rows: Record<string, string>[]) => {
  const columns = Object.keys(rows[0] ?? cli);
  const escape = (field: string) => `"${field.replaceAll('"', '""')}"`;
  return [
    columns.map(escape).join(","),
    ...rows.map((row) => columns.map((column) => escape(row[column] ?? "")).join(",")),
  ].join("\r\n");
};
const months = Array.from({ length: 13 }, (_, index) => {
  const date = new Date(Date.UTC(2025, 8 + index, 1));
  return `${date.getUTCFullYear()}年${date.getUTCMonth() + 1}月`;
});
function nbsHtml(extraManufacturing = "") {
  return `<p>发布时间：2026-09-30 09:30</p><p>中国制造业 PMI 及构成指数（经季节调整）</p>
  <table><tr><td>PMI</td><td>新订单</td></tr>${months.map((month, index) => `<tr><td>${month}</td><td>${index === 0 ? "0" : "50.1"}</td><td>51.7</td><td>${index === 0 ? "—" : "50.5"}</td><td>48.2</td><td>48.4</td><td>50.1</td></tr>`).join("")}${extraManufacturing}</table>
  <table><tr><td>商务活动</td></tr>${months.map((month) => `<tr><td>${month}</td><td>50.2</td><td>46.5</td></tr>`).join("")}</table>`;
}

afterEach(() => vi.unstubAllGlobals());

describe("official OECD monthly cycle semantics", () => {
  it("parses actual CLI levels with verified amplitude adjustment and provenance", () => {
    const [series] = parseOecdCliCsv(csv([cli]), fetchedAt);
    expect(series?.indicator).toBe("cli");
    expect(series?.seasonalAdjustment).toBe("SA");
    expect(series?.unit).toBe("index");
    expect(series?.sourceUpdatedAt).toBeNull();
    expect(series?.source.url).toBe(OECD_CLI_URL);
    expect(series?.observations).toEqual([{ period: "2026-09", value: 100.5, status: "A" }]);
  });

  it("retains zeros, nulls and provisional statuses without interpolation", () => {
    const [series] = parseOecdCliCsv(
      csv([
        { ...cli, TIME_PERIOD: "2026-07", OBS_VALUE: "0" },
        { ...cli, TIME_PERIOD: "2026-09", OBS_VALUE: "", OBS_STATUS: "P" },
      ]),
      fetchedAt,
    );
    expect(series?.observations).toEqual([
      { period: "2026-07", value: 0, status: "A" },
      { period: "2026-09", value: null, status: "P" },
    ]);
  });

  it("rejects wrong frequencies, transformations and unit multipliers", () => {
    expect(() => parseOecdCliCsv(csv([{ ...cli, FREQ: "Q" }]), fetchedAt)).toThrow("维度或频率");
    expect(() => parseOecdCliCsv(csv([{ ...cli, ADJUSTMENT: "TR" }]), fetchedAt)).toThrow(
      "维度或频率",
    );
    expect(() => parseOecdCliCsv(csv([{ ...cli, TRANSFORMATION: "GY" }]), fetchedAt)).toThrow(
      "维度或频率",
    );
    expect(() => parseOecdCliCsv(csv([{ ...cli, UNIT_MULT: "3" }]), fetchedAt)).toThrow("单位倍数");
    expect(() => parseOecdCliCsv(csv([{ ...cli, TIME_PERIOD: "2026-Q3" }]), fetchedAt)).toThrow(
      "观测期与频率",
    );
  });

  it("deduplicates identical values but rejects conflicting official observations", () => {
    expect(parseOecdCliCsv(csv([cli, cli]), fetchedAt)[0]?.observations).toHaveLength(1);
    expect(() => parseOecdCliCsv(csv([cli, { ...cli, OBS_VALUE: "101" }]), fetchedAt)).toThrow(
      "同期观测冲突",
    );
  });

  it("discards forecast and future periods while keeping stale actual history unchanged", () => {
    const [series] = parseOecdCliCsv(
      csv([
        { ...cli, TIME_PERIOD: "2000-01", OBS_VALUE: "99" },
        { ...cli, TIME_PERIOD: "2026-11" },
        { ...cli, TIME_PERIOD: "2026-09", OBS_STATUS: "F" },
      ]),
      fetchedAt,
    );
    expect(series?.observations).toEqual([{ period: "2000-01", value: 99, status: "A" }]);
  });

  it("keeps quarterly GDP YoY separate from QoQ and labels real retail volume correctly", () => {
    const series = parseOecdKeiCsv(
      csv([
        {
          ...kei,
          FREQ: "Q",
          MEASURE: "B1GQ_Q",
          ACTIVITY: "_T",
          ADJUSTMENT: "Y",
          TIME_PERIOD: "2026-Q2",
          TRANSFORMATION: "GY",
        },
        {
          ...kei,
          FREQ: "Q",
          MEASURE: "B1GQ_Q",
          ACTIVITY: "_T",
          ADJUSTMENT: "Y",
          TIME_PERIOD: "2026-Q2",
          TRANSFORMATION: "G1",
        },
        {
          ...kei,
          MEASURE: "TOVM",
          UNIT_MEASURE: "IX",
          ACTIVITY: "G47",
          ADJUSTMENT: "Y",
          TRANSFORMATION: "_Z",
          OBS_VALUE: "120",
          OBS_STATUS: "P",
        },
      ]),
      fetchedAt,
    );
    expect(series).toHaveLength(2);
    expect(series.find((item) => item.indicator === "gdpGrowth")?.frequency).toBe("Q");
    expect(series.find((item) => item.indicator === "gdpGrowth")?.note).toContain("同比");
    expect(series.find((item) => item.indicator === "retailVolume")?.unit).toBe("index");
    expect(series.find((item) => item.indicator === "retailVolume")?.observations[0]?.status).toBe(
      "P",
    );
    expect(series.find((item) => item.indicator === "retailVolume")?.source.url).toBe(OECD_KEI_URL);
  });

  it("preserves the actual stale Japanese CPI period and an explicit limitation note", () => {
    const [series] = parseOecdKeiCsv(
      csv([{ ...kei, REF_AREA: "JPN", TIME_PERIOD: "2021-06", OBS_VALUE: "-0.5" }]),
      fetchedAt,
    );
    expect(series?.observations[0]?.period).toBe("2021-06");
    expect(series?.note).toContain("过期历史序列");
    expect(series?.seasonalAdjustment).toBe("NSA");
  });

  it("validates the OECD core basket and current Japanese COICOP2018 continuation", () => {
    const price = {
      ...kei,
      DATAFLOW: "OECD.SDD.TPS:DSD_PRICES@DF_PRICES_ALL(1.0)",
      METHODOLOGY: "N",
      MEASURE: "CPI",
      UNIT_MEASURE: "PA",
      EXPENDITURE: "_TXCP01_NRG",
      ADJUSTMENT: "N",
      OBS_STATUS: "E",
    };
    const [core] = parseOecdCoreCsv(csv([{ ...price, UNIT_MULT: "" }]), fetchedAt);
    expect(core?.indicator).toBe("coreInflation");
    expect(core?.observations[0]?.status).toBe("E");
    expect(core?.seasonalAdjustment).toBe("NSA");
    expect(() => parseOecdCoreCsv(csv([{ ...price, EXPENDITURE: "_T" }]), fetchedAt)).toThrow(
      "维度不匹配",
    );
    const [japan] = parseOecdJapanPricesCsv(
      csv([
        {
          ...price,
          REF_AREA: "JPN",
          DATAFLOW: "OECD.SDD.TPS:DSD_PRICES_COICOP2018@DF_PRICES_C2018_ALL(1.0)",
          EXPENDITURE: "_T",
          TIME_PERIOD: "2026-08",
          OBS_VALUE: "1.9",
        },
      ]),
      fetchedAt,
    );
    expect(japan?.indicator).toBe("inflation");
    expect(japan?.observations[0]?.value).toBe(1.9);
    expect(japan?.note).toContain("COICOP2018");
  });

  it("handles escaped CSV labels and refuses HTML/error responses or malformed records", () => {
    expect(parseOecdCsv(csv([{ ...cli, BASE_PER: '2015, "base"' }]))[0]?.["BASE_PER"]).toBe(
      '2015, "base"',
    );
    expect(() => parseOecdCsv("<html>Access denied</html>")).toThrow("缺少数据维度");
    expect(() => parseOecdCsv(csv([cli]) + '\n"unclosed')).toThrow("引号未闭合");
    expect(() => parseOecdCliCsv(csv([{ ...cli, OBS_VALUE: "invalid" }]), fetchedAt)).toThrow(
      "观测值无效",
    );
  });

  it("does not substitute synthetic data when OECD responds with a blocked endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 403 })));
    await expect(fetchOecdCycleSnapshot()).rejects.toThrow("HTTP 403");
  });
});

describe("NBS published China PMI tables", () => {
  it("keeps manufacturing, new orders and non-manufacturing distinct with original table dates", () => {
    const snapshot = parseChinaPmiHtml(nbsHtml(), fetchedAt);
    expect(snapshot.series.map((series) => series.indicator)).toEqual([
      "pmiManufacturing",
      "pmiNewOrders",
      "pmiNonManufacturing",
    ]);
    expect(
      snapshot.series.every(
        (series) =>
          series.observations.length === 13 &&
          series.sourceUpdatedAt === "2026-09-30" &&
          series.seasonalAdjustment === "SA",
      ),
    ).toBe(true);
    expect(snapshot.series[0]?.observations[0]?.value).toBe(0);
    expect(snapshot.series[1]?.observations[0]?.value).toBeNull();
    expect(snapshot.series[2]?.source.name).toContain("含建筑业");
    expect(snapshot.series.every((series) => series.indicator !== "pmiServices")).toBe(true);
  });

  it("rejects missing headings, short histories and wrong diffusion-index values", () => {
    expect(() => parseChinaPmiHtml(nbsHtml().replaceAll("经季节调整", ""), fetchedAt)).toThrow(
      "季节调整说明",
    );
    expect(() =>
      parseChinaPmiHtml(
        nbsHtml().replace("<td>50.1</td><td>51.7", "<td>150</td><td>51.7"),
        fetchedAt,
      ),
    ).toThrow("扩散指数范围");
    expect(() => parseChinaPmiHtml("<table><tr><td>PMI</td></tr></table>", fetchedAt)).toThrow(
      "表格",
    );
    expect(() => parseChinaPmiHtml(nbsHtml(), "2025-01-01T00:00:00Z")).toThrow("晚于抓取时间");
  });

  it("deduplicates repeated table rows and discards a future month", () => {
    const duplicate = "<tr><td>2026年9月</td><td>50.1</td><td>51.7</td><td>50.5</td></tr>";
    const future = "<tr><td>2027年1月</td><td>55</td><td>56</td><td>57</td></tr>";
    expect(
      parseChinaPmiHtml(nbsHtml(duplicate + future), fetchedAt).series[0]?.observations,
    ).toHaveLength(13);
    expect(() => parseChinaPmiHtml(nbsHtml(duplicate.replace("50.1", "51.1")), fetchedAt)).toThrow(
      "同期记录冲突",
    );
  });

  it("reports HTTP failure without returning invented PMI", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 503 })));
    await expect(fetchChinaCycleSnapshot()).rejects.toThrow("HTTP 503");
  });
});

describe("bundled authoritative monthly resources", () => {
  it("contains five true CLI histories and exact quarterly/monthly source metadata", () => {
    const cliSeries = bundledOecdSnapshot.series.filter((series) => series.indicator === "cli");
    expect(cliSeries.map((series) => series.country).sort()).toEqual([
      "CHN",
      "DEU",
      "GBR",
      "JPN",
      "USA",
    ]);
    expect(
      cliSeries.every(
        (series) =>
          series.observations[0]?.period === "2000-01" &&
          series.observations.length >= 300 &&
          series.frequency === "M",
      ),
    ).toBe(true);
    expect(
      bundledOecdSnapshot.series.every(
        (series) =>
          series.sourceUpdatedAt === null &&
          series.source.url.startsWith("https://sdmx.oecd.org/") &&
          series.observations.every(
            (point) => point.value === null || Number.isFinite(point.value),
          ),
      ),
    ).toBe(true);
    expect(
      bundledOecdSnapshot.series
        .filter((series) => series.indicator === "gdpGrowth")
        .every((series) => series.frequency === "Q" && series.source.seriesCode.endsWith(".GY")),
    ).toBe(true);
  });

  it("contains current Japanese CPI instead of stale KEI observations, plus actual core inflation", () => {
    const japan = bundledOecdSnapshot.series.find(
      (series) => series.country === "JPN" && series.indicator === "inflation",
    );
    expect(japan?.source.seriesCode).toContain("COICOP2018");
    expect(japan?.observations.at(-1)?.period).toBe("2026-08");
    expect(
      bundledOecdSnapshot.series.filter((series) => series.indicator === "coreInflation"),
    ).toHaveLength(4);
  });

  it("contains 13 actual months from the original NBS manufacturing and non-manufacturing tables", () => {
    expect(bundledChinaSnapshot.series).toHaveLength(3);
    expect(
      bundledChinaSnapshot.series.every(
        (series) =>
          series.country === "CHN" &&
          series.frequency === "M" &&
          series.source.url === CHINA_PMI_SOURCE_URL &&
          series.observations.length === 13,
      ),
    ).toBe(true);
    expect(
      bundledChinaSnapshot.series
        .find((series) => series.indicator === "pmiManufacturing")
        ?.observations.at(-1),
    ).toEqual({ period: "2026-09", value: 50.1 });
  });
});
