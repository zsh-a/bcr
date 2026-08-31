import { describe, expect, it } from "vitest";
import {
  createDemoSnapshot,
  instrumentsFor,
  quoteSparkline,
  ResilientMarketService,
  type MarketDataProvider,
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
    expect(snapshot.quotes).toHaveLength(9);
    expect(snapshot.futures).toHaveLength(6);
    expect(snapshot.sessions).toHaveLength(4);
    expect(new Set(snapshot.quotes.map((quote) => quote.instrument.id)).size).toBe(9);
    expect(instrumentsFor("CN")).toHaveLength(3);
    expect(instrumentsFor("HK")).toHaveLength(3);
    expect(instrumentsFor("US")).toHaveLength(3);
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
});
