import { afterEach, describe, expect, it, vi } from "vitest";
import { instrumentsFor, StockSdkProvider } from "../src";
import { loadTencentTrendHistory } from "../src/tencent-trend";

const instrument = instrumentsFor("CN")[0]!;
const rows = [
  ["2026-09-28", "100", "103", "104", "99", "1000"],
  ["2026-09-29", "103", "101", "105", "100", "2000"],
  ["2026-09-30", "101", "104", "106", "100", "3000"],
];

afterEach(() => vi.unstubAllGlobals());

function mockHistory(symbol: string, data: unknown) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    Response.json({ code: 0, data: { [symbol]: data } }),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("Tencent short real price history", () => {
  it("uses adjusted daily prices, validates OHLC ordering, and never infers volume from inconsistent vendor units", async () => {
    const fetch = mockHistory("sh000001", {
      qfqday: [
        ...rows,
        ["2026-09-30", "null", "104", "106", "100"],
        ["2026-09-30", "101", "104", "100", "99"],
      ],
      day: rows.map((row) => [row[0], "999", "999", "999", "999"]),
    });
    const result = await loadTencentTrendHistory({ instrument, range: "1M" });
    const [url, options] = fetch.mock.calls[0]! as unknown as [URL, RequestInit];
    expect(url.pathname).toBe("/appstock/app/fqkline/get");
    expect(url.searchParams.get("param")).toBe("sh000001,day,,,40,qfq");
    expect(options.credentials).toBe("omit");
    expect(result.bars.map((bar) => bar.close)).toEqual([103, 101, 104]);
    expect(result.bars.every((bar) => bar.volume === 0 && bar.amount === null)).toBe(true);
    expect(result.source).toBe("腾讯 · 前复权日线");
    expect(result.quality).toBe("delayed");
  });

  it("uses the US-specific endpoint and preserves US and HK index symbols", async () => {
    for (const [market, sourceSymbol, endpoint] of [
      ["US", "INX", "usfqkline"],
      ["HK", "HSI", "fqkline"],
    ] as const) {
      const instrument = instrumentsFor(market).find((item) => item.sourceSymbol === sourceSymbol)!;
      const symbol = `${market.toLowerCase()}${sourceSymbol}`;
      const fetch = mockHistory(symbol, { day: rows });
      const series = await loadTencentTrendHistory({ instrument, range: "1M" });
      expect((fetch.mock.calls[0]![0] as URL).pathname).toBe(`/appstock/app/${endpoint}/get`);
      expect(series.instrument.id).toBe(instrument.id);
      expect(series.bars).toHaveLength(3);
      expect(series.source).toBe("腾讯 · 日线");
    }
  });

  it("rejects too-short, invalid and wrong-instrument data", async () => {
    for (const data of [
      { day: rows.slice(0, 2) },
      { day: null },
      { day: [["not-a-date", "1", "2", "3", "1"]] },
    ]) {
      mockHistory("sh000001", data);
      await expect(loadTencentTrendHistory({ instrument, range: "1M" })).rejects.toThrow();
    }
    mockHistory("sh600519", { day: rows });
    await expect(loadTencentTrendHistory({ instrument, range: "1M" })).rejects.toThrow();
  });

  it("tries the SDK after primary source failure without introducing demo prices", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("Tencent unavailable");
      }),
    );
    const provider = new StockSdkProvider();
    const secondary = vi
      .spyOn(provider, "loadHistory")
      .mockRejectedValue(new Error("Eastmoney unavailable"));
    const request = { instrument, range: "1M" as const };
    await expect(provider.loadTrendHistory(request)).rejects.toThrow("Eastmoney unavailable");
    expect(secondary).toHaveBeenCalledWith(request, undefined);
  });

  it("does not fall through to another source after cancellation", async () => {
    const abort = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        abort.abort();
        return Response.json({ code: 0, data: { sh000001: { day: rows } } });
      }),
    );
    const provider = new StockSdkProvider();
    const secondary = vi.spyOn(provider, "loadHistory");
    await expect(
      provider.loadTrendHistory({ instrument, range: "1M" }, abort.signal),
    ).rejects.toThrow();
    expect(secondary).not.toHaveBeenCalled();
  });
});
