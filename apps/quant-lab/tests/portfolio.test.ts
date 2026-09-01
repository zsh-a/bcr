import { describe, expect, it } from "vitest";
import type { MarketBar, PortfolioSeries } from "../src/model";
import {
  alignPortfolioSeries,
  buildPortfolioAnalysis,
  computeCorrelationMatrix,
  runPortfolioBacktest,
} from "../src/portfolio";

function series(
  symbol: string,
  closes: ReadonlyArray<number>,
  dates = closes.map((_, index) => `2024-01-${String(index + 1).padStart(2, "0")}`),
): PortfolioSeries {
  const bars: MarketBar[] = closes.map((close, index) => ({
    date: dates[index] ?? "",
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
  }));
  return {
    instrumentId: symbol,
    symbol,
    name: symbol,
    market: "US",
    bars,
  };
}

describe("Portfolio analysis", () => {
  it("按共同交易日对齐并识别正负相关", () => {
    const dates = ["2024-01-01", "2024-01-02", "2024-01-03", "2024-01-04"];
    const aligned = alignPortfolioSeries([
      series("UP", [100, 110, 99, 108], dates),
      series("DOWN", [100, 90, 101, 92], dates),
    ]);
    expect(aligned.dates).toEqual(dates);
    expect(aligned.returns).toHaveLength(2);

    const matrix = computeCorrelationMatrix([
      series("UP", [100, 110, 99, 108], dates),
      series("DOWN", [100, 90, 101, 92], dates),
    ]);
    expect(matrix.observations).toBe(3);
    expect(matrix.values[0]?.[0]).toBe(1);
    expect(matrix.values[0]?.[1]).toBeLessThan(-0.99);
    expect(matrix.values[1]?.[0]).toBeLessThan(-0.99);
  });

  it("只使用所有标的共有日期", () => {
    const aligned = alignPortfolioSeries([
      series("A", [100, 101, 102], ["2024-01-01", "2024-01-02", "2024-01-03"]),
      series("B", [200, 202, 204], ["2024-01-02", "2024-01-03", "2024-01-04"]),
    ]);
    expect(aligned.dates).toEqual(["2024-01-02", "2024-01-03"]);
    expect(aligned.returns[0]).toEqual([102 / 101 - 1]);
    expect(() =>
      alignPortfolioSeries([
        series("A", [100, 101], ["2024-01-01", "2024-01-02"]),
        series("B", [200, 201], ["2024-01-03", "2024-01-04"]),
      ]),
    ).toThrow("overlapping observations");
  });

  it("生成有限值的等权组合回测与分析快照", () => {
    const input = [
      series("A", [100, 110, 121, 133.1]),
      series("B", [100, 100, 100, 100]),
      series("C", [100, 95, 104.5, 109.725]),
    ];
    const result = runPortfolioBacktest(input, { initialCapital: 100_000, feeBps: 8 });
    const analysis = buildPortfolioAnalysis(input, { initialCapital: 100_000, feeBps: 8 });

    expect(result.equity).toHaveLength(4);
    expect(result.weights.map((item) => item.weight)).toEqual([1 / 3, 1 / 3, 1 / 3]);
    expect(result.metrics.seriesCount).toBe(3);
    expect(result.metrics.observations).toBe(3);
    expect(result.metrics.finalEquity).toBeGreaterThan(100_000);
    expect(analysis.correlation.symbols).toEqual(["A", "B", "C"]);
    expect(Object.values(result.metrics).every((value) => Number.isFinite(value))).toBe(true);
  });

  it("拒绝重复日期和没有有效收盘价的序列", () => {
    expect(() =>
      alignPortfolioSeries([
        series("A", [100, 101], ["2024-01-01", "2024-01-01"]),
        series("B", [100, 101]),
      ]),
    ).toThrow("duplicate date");
    expect(() =>
      alignPortfolioSeries([series("A", [Number.NaN, Number.NaN]), series("B", [100, 101])]),
    ).toThrow("no valid closing prices");
  });
});
