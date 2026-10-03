import { MINUTE, type MinuteBar } from "@bcr/market-data/binance/model";
import { describe, expect, it } from "vitest";
import {
  TrendChannelProjection,
  trendEntryEvidence,
  type TrendChartData,
  type TrendTrade,
} from "../src/trend";

const candle = (time: number, high: number, low = high - 2): MinuteBar => ({
  time,
  open: low + 1,
  high,
  low,
  close: low + 1,
  volume: 1,
});
describe("causal trend channel overlays", () => {
  it("uses only previous closed candles for entry and exit, including when extremes roll out", () => {
    const projection = new TrendChannelProjection(
      { tradeMinutes: 1, entryBars: 3, exitBars: 1 },
      3 * MINUTE,
      6 * MINUTE,
      1,
    );
    projection.append([
      candle(0, 900),
      candle(MINUTE, 101),
      candle(2 * MINUTE, 102),
      candle(3 * MINUTE, 103),
      candle(4 * MINUTE, 1000, 1),
      candle(5 * MINUTE, 1100),
    ]);
    expect(projection.points).toEqual([
      { time: 3 * MINUTE, upper: 900, lower: 99, exitUpper: 102, exitLower: 100 },
      { time: 4 * MINUTE, upper: 103, lower: 99, exitUpper: 103, exitLower: 101 },
      { time: 5 * MINUTE, upper: 1000, lower: 1, exitUpper: 1000, exitLower: 1 },
    ]);
  });
  it("coarse display samples boundaries at the open without looking inside that display candle", () => {
    const bars = [
      candle(0, 101),
      candle(5 * MINUTE, 102),
      candle(10 * MINUTE, 103),
      candle(15 * MINUTE, 999),
      candle(20 * MINUTE, 110),
      candle(25 * MINUTE, 111),
      candle(30 * MINUTE, 112),
    ];
    const make = () =>
      new TrendChannelProjection(
        { tradeMinutes: 5, entryBars: 2, exitBars: null },
        15 * MINUTE,
        45 * MINUTE,
        15,
      );
    const all = make(),
      split = make();
    all.append(bars);
    split.append(bars.slice(0, 4));
    split.append(bars.slice(4));
    expect(all.points).toEqual([
      { time: 15 * MINUTE, upper: 103, lower: 100 },
      { time: 30 * MINUTE, upper: 111, lower: 108 },
    ]);
    expect(split.points).toEqual(all.points);
    expect(
      () =>
        new TrendChannelProjection({ tradeMinutes: 5, entryBars: 2, exitBars: 2 }, 0, MINUTE, 5),
    ).toThrow();
  });
  it("does not invent thresholds without the full lookback", () => {
    const projection = new TrendChannelProjection(
      { tradeMinutes: 1, entryBars: 20, exitBars: 10 },
      0,
      2 * MINUTE,
      1,
    );
    projection.append([candle(0, 100), candle(MINUTE, 101)]);
    expect(projection.points).toEqual([]);
  });
});

describe("trade entry evidence", () => {
  const channel = { tradeMinutes: 1, entryBars: 20, exitBars: 10 };
  const trade = { entryTime: MINUTE, side: "long" } as TrendTrade;
  const data = {
    minutes: 1,
    bars: [candle(0, 110)],
    channels: [{ time: 0, upper: 105, lower: 95 }],
  } as TrendChartData;
  it("prefers the frozen signal over inferred historical prices", () => {
    const entrySignal = { time: 123, price: 102, boundary: 100, atr: 2, lookbackBars: 20 };
    expect(trendEntryEvidence({ ...trade, entrySignal }, channel, data)).toEqual({
      source: "recorded",
      ...entrySignal,
    });
  });
  it("labels historical reconstruction and never fabricates ATR", () => {
    expect(trendEntryEvidence(trade, channel, data)).toEqual({
      source: "derived",
      time: MINUTE - 1,
      price: 109,
      boundary: 105,
      lookbackBars: 20,
      atr: undefined,
    });
    expect(trendEntryEvidence({ ...trade, side: "short" }, channel, data)?.boundary).toBe(95);
    expect(trendEntryEvidence(trade, channel, { ...data, minutes: 5 })).toBeUndefined();
    expect(trendEntryEvidence({ ...trade, entryTime: MINUTE + 1 }, channel, data)).toBeUndefined();
    expect(trendEntryEvidence(trade, undefined, data)).toBeUndefined();
  });
});
