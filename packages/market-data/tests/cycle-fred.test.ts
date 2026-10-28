import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FRED_CYCLE_DEFINITIONS,
  buildFredCycleSeries,
  fetchFredCycleSnapshot,
  monthlyYearOverYear,
  parseFredCsv,
  parseFredMirror,
  parseInitialClaimsXml,
  subtractCycleObservations,
} from "../src/cycle/fred";
import { bundledFredSnapshot, decodeFredSnapshot } from "../src/cycle/fred-snapshot";

const now = new Date("2026-10-25T08:00:00.000Z");
const definition = (code: string) => FRED_CYCLE_DEFINITIONS.find((item) => item.code === code)!;
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("US native-frequency cycle sources", () => {
  it("parses official CSV without converting missing, empty or zero values into one another", () => {
    expect(
      parseFredCsv(
        "observation_date,UNRATE\n2024-03-01,0\n2024-01-01,.\n2024-02-01,\n",
        "UNRATE",
        "M",
        now,
      ),
    ).toEqual([
      { period: "2024-01", value: null },
      { period: "2024-02", value: null },
      { period: "2024-03", value: 0 },
    ]);
    expect(
      parseFredCsv("DATE,A191RL1Q225SBEA\n2024-04-01,2.2", "A191RL1Q225SBEA", "Q", now),
    ).toEqual([{ period: "2024-Q2", value: 2.2 }]);
    expect(parseFredCsv("DATE,ICSA\n2024-07-06,210000", "ICSA", "W", now)[0]?.period).toBe(
      "2024-07-06",
    );
  });

  it("rejects wrong series, duplicate periods, impossible dates, future dates and invalid values", () => {
    for (const text of [
      "DATE,PAYEMS\n2024-01-01,1",
      "DATE,UNRATE\n2024-01-01,1\n2024-01-01,2",
      "DATE,UNRATE\n2024-02-30,1",
      "DATE,UNRATE\n2024-02-02,1",
      "DATE,UNRATE\n2027-01-01,1",
      "DATE,UNRATE\n2024-01-01,Infinity",
      "DATE,UNRATE\n2024-01-01,3 people",
    ])
      expect(() => parseFredCsv(text, "UNRATE", "M", now)).toThrow();
    expect(() => parseFredCsv("DATE,GDP\n2024-02-01,1", "GDP", "Q", now)).toThrow();
  });

  it("computes CPI YoY from the exact previous-year month and preserves missing bases", () => {
    const values = monthlyYearOverYear([
      { period: "2023-01", value: 100 },
      { period: "2023-03", value: 0 },
      { period: "2024-01", value: 110 },
      { period: "2024-02", value: 120 },
      { period: "2024-03", value: 130 },
      { period: "2024-04", value: null },
    ]);
    expect(values[2]?.value).toBeCloseTo(10);
    expect(values[3]?.value).toBeNull();
    expect(values[4]?.value).toBeNull();
    expect(values[5]?.value).toBeNull();
  });

  it("aligns Treasury rates by same date without carrying values across holidays", () => {
    expect(
      subtractCycleObservations(
        [
          { period: "2024-01-02", value: 4 },
          { period: "2024-01-03", value: 5 },
        ],
        [
          { period: "2024-01-02", value: 3 },
          { period: "2024-01-04", value: 2 },
        ],
      ),
    ).toEqual([
      { period: "2024-01-02", value: 1 },
      { period: "2024-01-03", value: null },
      { period: "2024-01-04", value: null },
    ]);
  });

  it("extracts only initial seasonally adjusted claims from the DOL native weekly XML", () => {
    const xml =
      '<r539cyNational rundate="10/25/2026"><week><weekEnded>07/06/2024</weekEnded><InitialClaims><NSA>123,456</NSA><SA>210,000</SA></InitialClaims><ContinuedClaims><SA>1,800,000</SA></ContinuedClaims></week></r539cyNational>';
    expect(parseInitialClaimsXml(xml, now)).toEqual([{ period: "2024-07-06", value: 210000 }]);
    const calendar = xml.replace(
      "</r539cyNational>",
      "<week><weekEnded>07/13/2024</weekEnded><InitialClaims><SA>&#160;</SA></InitialClaims></week><week><weekEnded>11/07/2026</weekEnded><InitialClaims><SA>&#160;</SA></InitialClaims></week></r539cyNational>",
    );
    expect(parseInitialClaimsXml(calendar, now)).toEqual([
      { period: "2024-07-06", value: 210000 },
      { period: "2024-07-13", value: null },
    ]);
    expect(() => parseInitialClaimsXml(xml.replace("07/06/2024", "07/07/2024"), now)).toThrow();
    expect(() => parseInitialClaimsXml(xml.replace("210,000", "2,1,000"), now)).toThrow();
  });

  it("validates mirror identity, converts millions to billions and separates revision from mirror indexing", () => {
    const payload = {
      dataset: {
        name: "Real PCE - LastRevised: September 30, 2026",
        indexed_at: "2026-10-01T01:31:34Z",
      },
      series: {
        docs: [
          {
            provider_code: "BEA",
            dataset_code: "NIPA-T20806",
            series_code: "DPCERX-M",
            period: ["2026-08"],
            value: [16955276],
          },
        ],
      },
    };
    const parsed = parseFredMirror(payload, definition("PCEC96"), now);
    expect(parsed.observations[0]?.value).toBeCloseTo(16955.276);
    expect(parsed.sourceUpdatedAt).toBe("2026-09-30");
    expect(
      parseFredMirror(
        { ...payload, dataset: { indexed_at: "2026-10-01T01:31:34Z" } },
        definition("PCEC96"),
        now,
      ).sourceUpdatedAt,
    ).toBeNull();
    expect(() => parseFredMirror(payload, definition("W875RX1"), now)).toThrow();
  });

  it("retains correct real PCE and SAAR metadata and bounds native daily history", () => {
    const pce = buildFredCycleSeries(
      definition("PCEC96"),
      [
        { period: "1999-12", value: 100 },
        { period: "2024-01", value: 110 },
      ],
      now.toISOString(),
      null,
      true,
    );
    expect(pce.indicator).toBe("realConsumption");
    expect(pce.note).toContain("并非零售销售");
    expect(pce.note).toContain("季调年率");
    expect(pce.source.name).toContain("DBnomics");
    expect(pce.observations).toEqual([{ period: "2024-01", value: 110 }]);
    const spread = buildFredCycleSeries(
      definition("T10Y3M"),
      [
        { period: "2001-01-01", value: 1 },
        { period: "2026-10-23", value: 0.78 },
      ],
      now.toISOString(),
      null,
    );
    expect(spread.observations).toHaveLength(1);
    expect(definition("A191RL1Q225SBEA").indicator).toBe("gdpQuarterlyAnnualized");
    expect(definition("A191RL1Q225SBEA").note).toContain("不是普通环比");
  });

  it("loads a genuinely frozen snapshot without a network request and rejects corrupted coverage", () => {
    const network = vi.fn();
    vi.stubGlobal("fetch", network);
    expect(bundledFredSnapshot.series.length).toBeGreaterThanOrEqual(5);
    expect(
      bundledFredSnapshot.series.every((series) =>
        series.observations.every((point) => point.period >= "2000"),
      ),
    ).toBe(true);
    expect(bundledFredSnapshot.series.some((series) => series.frequency === "W")).toBe(true);
    const gdp = bundledFredSnapshot.series.find((series) =>
      series.source.seriesCode.includes("A191RL1Q225SBEA"),
    );
    expect(gdp?.indicator).toBe("gdpQuarterlyAnnualized");
    expect(bundledFredSnapshot.series.some((series) => series.indicator === "gdpGrowth")).toBe(
      false,
    );
    expect(network).not.toHaveBeenCalled();
    expect(() =>
      decodeFredSnapshot({
        ...bundledFredSnapshot,
        series: [bundledFredSnapshot.series[0], bundledFredSnapshot.series[0]],
      }),
    ).toThrow();
    expect(() =>
      decodeFredSnapshot({
        ...bundledFredSnapshot,
        series: [{ ...bundledFredSnapshot.series[0], unit: "persons" }],
      }),
    ).toThrow();
  });

  it("can reproduce all permitted series via official CSV and obeys an already-aborted signal", async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes("doleta")) return new Response("unavailable", { status: 503 });
      const code = new URL(url).searchParams.get("id")!;
      const item = definition(code);
      const dates =
        item.frequency === "W" ? ["2024-01-06", "2024-01-13"] : ["2023-01-01", "2024-01-01"];
      return new Response(`observation_date,${code}\n${dates[0]},100\n${dates[1]},110`);
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", fetcher);
    const snapshot = await fetchFredCycleSnapshot();
    expect(snapshot.series).toHaveLength(FRED_CYCLE_DEFINITIONS.length);
    expect(snapshot.series.some((series) => series.indicator === "gdpGrowth")).toBe(false);
    expect(snapshot.series.every((series) => series.sourceUpdatedAt === null)).toBe(true);
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    const calls = fetcher.mock.calls.length;
    await expect(fetchFredCycleSnapshot(controller.signal)).rejects.toThrow("cancelled");
    expect(fetcher).toHaveBeenCalledTimes(calls);
  });
});
