import { describe, expect, it } from "vitest";
import {
  createDemoSnapshot,
  createDemoHistory,
  instrumentsFor,
  quoteSparkline,
  ResilientMarketService,
  searchKnownInstruments,
  type MarketDataProvider,
  type MarketHistoryProvider,
} from "../src";

describe("Market data contracts", () => {
  it("生成稳定且以最新价收尾的微型走势", () => {
    const first = quoteSparkline("US:INDEX:INX", 6_400, 1.25);
    const second = quoteSparkline("US:INDEX:INX", 6_400, 1.25);

    expect(first).toEqual(second);
    expect(first).toHaveLength(28);
    expect(first.at(-1)).toBe(6_400);
    expect(new Set(first).size).toBeGreaterThan(20);
  });

  it("提供覆盖三地股票市场与全球期货的完整降级快照", () => {
    const snapshot = createDemoSnapshot(["upstream unavailable"]);

    expect(snapshot.quality).toBe("demo");
    expect(snapshot.quotes).toHaveLength(15);
    expect(snapshot.futures).toHaveLength(6);
    expect(snapshot.sessions).toHaveLength(4);
    expect(new Set(snapshot.quotes.map((quote) => quote.instrument.id)).size).toBe(15);
    expect(instrumentsFor("CN")).toHaveLength(5);
    expect(instrumentsFor("HK")).toHaveLength(5);
    expect(instrumentsFor("US")).toHaveLength(5);
  });

  it("上游整体失败时显式回退演示数据并保留错误", async () => {
    const provider: MarketDataProvider = {
      id: "failing-provider",
      loadSnapshot: () => Promise.reject(new Error("network offline")),
    };
    const snapshot = await new ResilientMarketService(provider).load();

    expect(snapshot.quality).toBe("demo");
    expect(snapshot.errors).toContain("network offline");
    expect(snapshot.quotes.every((quote) => quote.quality === "demo")).toBe(true);
  });

  it("为历史视图生成确定性且 OHLC 关系有效的降级序列", () => {
    const instrument = instrumentsFor("US")[1];
    if (instrument === undefined) throw new Error("missing US fixture");
    const request = { instrument, range: "3M" as const, referencePrice: 6_500 };
    const first = createDemoHistory(request, [], Date.UTC(2026, 7, 31));
    const second = createDemoHistory(request, [], Date.UTC(2026, 7, 31));

    expect(first.bars).toEqual(second.bars);
    expect(first.bars).toHaveLength(66);
    expect(first.bars.at(-1)?.close).toBeCloseTo(6_500);
    expect(
      first.bars.every(
        (bar) =>
          bar.high >= Math.max(bar.open, bar.close) && bar.low <= Math.min(bar.open, bar.close),
      ),
    ).toBe(true);
  });

  it("历史上游失败时回退可交互的演示 K 线", async () => {
    const instrument = instrumentsFor("CN")[1];
    if (instrument === undefined) throw new Error("missing CN fixture");
    const provider: MarketHistoryProvider = {
      id: "failing-history",
      loadHistory: () => Promise.reject(new Error("history offline")),
    };
    const { ResilientHistoryService } = await import("../src");
    const history = await new ResilientHistoryService(provider).load({
      instrument,
      range: "1Y",
      referencePrice: 4_600,
    });

    expect(history.quality).toBe("demo");
    expect(history.bars).toHaveLength(252);
    expect(history.errors).toContain("history offline");
  });

  it("离线目录可按中英文名称、代码和资产类别发现全球标的", () => {
    expect(searchKnownInstruments("茅台")[0]?.instrument.id).toBe("CN:SSE:600519");
    expect(searchKnownInstruments("TSLA")[0]?.instrument.market).toBe("US");
    expect(searchKnownInstruments("红利ETF")[0]?.instrument.assetClass).toBe("fund");
    expect(searchKnownInstruments("美团")[0]?.instrument.symbol).toBe("03690.HK");
  });
});
