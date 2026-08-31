import { describe, expect, it } from "vitest";
import { computeSmaSignals, generateDemoMarket, parseMarketCsv, runBacktest } from "../src/engine";

describe("Quant engine", () => {
  it("生成确定性 OHLCV 演示行情", () => {
    const first = generateDemoMarket(80);
    const second = generateDemoMarket(80);
    expect(first).toEqual(second);
    expect(first).toHaveLength(80);
    expect(first.every((bar) => bar.low <= Math.min(bar.open, bar.close))).toBe(true);
    expect(first.every((bar) => bar.high >= Math.max(bar.open, bar.close))).toBe(true);
  });

  it("解析标准 CSV 并按日期排序", () => {
    const rows = generateDemoMarket(30);
    const csv = [
      "date,open,high,low,close,volume",
      ...[...rows]
        .reverse()
        .map((bar) => [bar.date, bar.open, bar.high, bar.low, bar.close, bar.volume].join(",")),
    ].join("\n");
    const parsed = parseMarketCsv(csv);
    expect(parsed).toHaveLength(30);
    const first = parsed[0];
    const last = parsed.at(-1);
    expect(first).toBeDefined();
    expect(last).toBeDefined();
    expect(first !== undefined && last !== undefined && first.date < last.date).toBe(true);
  });

  it("SMA 交叉产生可回测信号，权益和指标保持有限值", () => {
    const bars = generateDemoMarket(320);
    const signals = computeSmaSignals(bars, 12, 48);
    const result = runBacktest(bars, signals, { initialCapital: 100_000, feeBps: 8 });

    expect(signals).toHaveLength(bars.length);
    expect(signals.some(({ action }) => action === "buy")).toBe(true);
    expect(signals.some(({ action }) => action === "sell")).toBe(true);
    expect(result.equity).toHaveLength(bars.length);
    expect(result.trades.length).toBeGreaterThan(0);
    expect(Object.values(result.metrics).every(Number.isFinite)).toBe(true);
    expect(result.metrics.maxDrawdown).toBeLessThanOrEqual(0);
  });

  it("拒绝非法周期和过短行情", () => {
    const bars = generateDemoMarket(30);
    expect(() => computeSmaSignals(bars, 20, 10)).toThrow("fast < slow");
    expect(() => computeSmaSignals(bars, 10, 50)).toThrow("行情长度不足");
  });
});
