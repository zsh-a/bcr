import { describe, expect, it } from "vitest";
import type { FullQuote, IndustryBoard } from "stock-sdk";
import {
  buildMarketLandscape,
  createDemoDividendSeries,
  createDemoMarketLandscape,
  createDemoSnapshot,
  createDemoHistory,
  instrumentsFor,
  isQuantHandoff,
  quoteSparkline,
  ResilientDividendService,
  ResilientMarketService,
  searchKnownInstruments,
  type MarketDataProvider,
  type MarketDiscoveryProvider,
  type MarketHistoryProvider,
  type MarketLandscapeProvider,
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

  it("为默认 A 股焦点提供明确标注的股息参考数据", () => {
    const moutai = instrumentsFor("CN").find((instrument) => instrument.id === "CN:SSE:600519");
    if (moutai === undefined) throw new Error("missing Moutai fixture");
    const series = createDemoDividendSeries(moutai);

    expect(series.coverage).toBe("available");
    expect(series.events.length).toBeGreaterThanOrEqual(3);
    expect(series.events[0]?.cashPerTen).toBe(280.24);
    expect(series.source).toContain("DEMO");
  });

  it("股息上游不可用时回退到可辨识的默认参考记录", async () => {
    const moutai = instrumentsFor("CN").find((instrument) => instrument.id === "CN:SSE:600519");
    if (moutai === undefined) throw new Error("missing Moutai fixture");
    const provider: Pick<MarketDiscoveryProvider, "loadDividends"> = {
      loadDividends: () => Promise.reject(new Error("dividend offline")),
    };
    const series = await new ResilientDividendService(provider).load(moutai);

    expect(series.coverage).toBe("available");
    expect(series.events.length).toBeGreaterThan(0);
    expect(series.source).toContain("DEMO");
    expect(series.source).toContain("UPSTREAM dividend offline");
  });

  it("不会为未覆盖的全球标的编造股息事件", async () => {
    const instrument = instrumentsFor("US").find((item) => item.assetClass === "equity");
    if (instrument === undefined) throw new Error("missing US equity fixture");
    const provider: Pick<MarketDiscoveryProvider, "loadDividends"> = {
      loadDividends: () => Promise.reject(new Error("dividend offline")),
    };

    await expect(new ResilientDividendService(provider).load(instrument)).rejects.toThrow(
      "dividend offline",
    );
  });

  it("离线目录可按中英文名称、代码和资产类别发现全球标的", () => {
    expect(searchKnownInstruments("茅台")[0]?.instrument.id).toBe("CN:SSE:600519");
    expect(searchKnownInstruments("TSLA")[0]?.instrument.market).toBe("US");
    expect(searchKnownInstruments("红利ETF")[0]?.instrument.assetClass).toBe("fund");
    expect(searchKnownInstruments("美团")[0]?.instrument.symbol).toBe("03690.HK");
    expect(searchKnownInstruments("黄金")[0]?.instrument.id).toBe("GLOBAL:FUTURE:GC00Y");
    expect(instrumentsFor("GLOBAL")).toHaveLength(8);
  });

  it("将全量 A 股行情归一化为广度与三类可下钻排行", () => {
    const quote = (
      code: string,
      name: string,
      changePercent: number,
      amount: number,
      limit: "up" | "down" | null = null,
    ) =>
      ({
        code,
        name,
        price: limit === "down" ? 9 : limit === "up" ? 11 : 10,
        changePercent,
        amount,
        turnoverRate: 2.4,
        limitUp: limit === "up" ? 11 : null,
        limitDown: limit === "down" ? 9 : null,
      }) as unknown as FullQuote;
    const board = {
      code: "BK0001",
      name: "测试行业",
      changePercent: 2.1,
      riseCount: 12,
      fallCount: 3,
      turnoverRate: 1.4,
      totalMarketCap: 10_000,
      leadingStock: "领涨股份",
      leadingStockChangePercent: 5.2,
    } as unknown as IndustryBoard;
    const landscape = buildMarketLandscape({
      quotes: [
        quote("600001", "沪市上涨", 10, 400, "up"),
        quote("000001", "深市下跌", -10, 900, "down"),
        quote("920001", "北交上涨", 3, 200),
        quote("900901", "B股排除", 9, 8_000),
      ],
      boards: [board],
      receivedAt: 123,
      provider: "fixture",
    });

    expect(landscape.breadth).toMatchObject({
      total: 3,
      advancing: 2,
      declining: 1,
      limitUp: 1,
      limitDown: 1,
      amount: 15_000_000,
    });
    expect(landscape.rankings.gainers[0]?.instrument.symbol).toBe("600001.SH");
    expect(landscape.rankings.decliners[0]?.instrument.symbol).toBe("000001.SZ");
    expect(landscape.rankings.turnover[0]?.amount).toBe(9_000_000);
    expect(landscape.sectors[0]?.name).toBe("测试行业");
  });

  it("市场扫描整体失败时回退完整可交互的行业与排行基线", async () => {
    const provider: MarketLandscapeProvider = {
      id: "failing-landscape",
      loadMarketLandscape: () => Promise.reject(new Error("scan offline")),
    };
    const { ResilientMarketLandscapeService } = await import("../src");
    const landscape = await new ResilientMarketLandscapeService(provider).load();
    const direct = createDemoMarketLandscape();

    expect(landscape.quality).toBe("demo");
    expect(landscape.errors).toContain("scan offline");
    expect(landscape.sectors).toHaveLength(14);
    expect(landscape.rankings.gainers).toHaveLength(8);
    expect(landscape.breadth.total).toBe(direct.breadth.total);
  });

  it("校验多标的 Quant handoff，并拒绝空序列", () => {
    const instrument = instrumentsFor("US")[0];
    if (instrument === undefined) throw new Error("missing US fixture");
    const bars = [
      {
        date: "2026-08-31",
        timestamp: null,
        open: 100,
        high: 101,
        low: 99,
        close: 100.5,
        volume: 1_000,
        amount: null,
      },
    ];
    expect(
      isQuantHandoff({
        version: 2,
        createdAt: 1,
        groupId: "core",
        groupName: "Core",
        range: "1Y",
        source: "fixture",
        series: [{ instrument, range: "1Y", bars, source: "fixture" }],
      }),
    ).toBe(true);
    expect(
      isQuantHandoff({
        version: 2,
        createdAt: 1,
        groupId: "core",
        groupName: "Core",
        range: "1Y",
        source: "fixture",
        series: [],
      }),
    ).toBe(false);
    expect(
      isQuantHandoff({
        version: 1,
        createdAt: 1,
        instrument,
        range: "1Y",
        bars,
        source: "legacy fixture",
      }),
    ).toBe(true);
  });
});
