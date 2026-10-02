import { describe, expect, it } from "vitest";
import {
  createTrendConfig,
  DEFAULT_TREND_CONFIG,
  TREND_PERIODS,
  TREND_RULES,
  trendRunView,
  trendWarmupDays,
  withTradingPeriod,
  validateTrendConfig,
  validateRecordedTrendConfig,
  type TrendRun,
  type ArchivedTrendConfig,
} from "../src/trend";

describe("trend research configuration", () => {
  it("defaults to an unfiltered channel with consistent ATR exits and continuous holding", () => {
    validateTrendConfig(DEFAULT_TREND_CONFIG);
    expect(DEFAULT_TREND_CONFIG.strategy.entry).toBe("breakout");
    expect(DEFAULT_TREND_CONFIG.strategy.filter).toBe("none");
    expect(DEFAULT_TREND_CONFIG.risk.flattenMinute).toBeNull();
    const copy = createTrendConfig();
    copy.strategy.stopAtr = 2;
    copy.risk.riskPct = 0.01;
    expect(DEFAULT_TREND_CONFIG.strategy.stopAtr).toBe(1.5);
    expect(DEFAULT_TREND_CONFIG.risk.riskPct).toBe(0.005);
  });
  it("rejects unsafe or malformed settings at the worker boundary", () => {
    const invalid = [
      null,
      [],
      { ...DEFAULT_TREND_CONFIG, version: 1 },
      { ...DEFAULT_TREND_CONFIG, trailingStartR: 2 },
    ];
    for (const [group, key, value] of [
      ["risk", "riskPct", 0.5],
      ["risk", "maxExposurePct", 2],
      ["risk", "cooldownMinutes", 0],
      ["strategy", "tradeMinutes", 7],
      ["strategy", "stopAtr", 0],
      ["strategy", "breakEvenAtr", -1],
      ["strategy", "trailingAtr", Infinity],
      ["strategy", "filter", "llm"],
      ["strategy", "impulseBars", 4],
      ["execution", "feeBps", NaN],
      ["execution", "quantityStep", 0],
    ] as const) {
      const copy = createTrendConfig();
      Object.assign(copy[group], { [key]: value });
      invalid.push(copy);
    }
    for (const value of invalid) expect(() => validateTrendConfig(value)).toThrow();
  });
  it("warms up only active rules and preserves windows across period changes", () => {
    for (const period of TREND_PERIODS)
      validateTrendConfig(withTradingPeriod(DEFAULT_TREND_CONFIG, period));
    const hourly = withTradingPeriod(DEFAULT_TREND_CONFIG, 60);
    expect(hourly.strategy.breakoutBars).toBe(20);
    expect(trendWarmupDays(hourly)).toBe(1);
    hourly.strategy.filter = "ema";
    expect(trendWarmupDays(hourly)).toBe(3);
    const daily = withTradingPeriod(DEFAULT_TREND_CONFIG, 1440);
    expect(trendWarmupDays(daily)).toBe(20);
    daily.strategy.breakoutBars = 250;
    expect(trendWarmupDays(daily)).toBe(250);
    daily.strategy.entry = "pullback";
    expect(trendWarmupDays(daily)).toBe(TREND_RULES.atrPeriod);
    daily.strategy.filter = "ema";
    expect(trendWarmupDays(daily)).toBe(TREND_RULES.slowEma);
    daily.risk.flattenMinute = 1437;
    expect(() => validateTrendConfig(daily)).toThrow();
    expect(withTradingPeriod(daily, 1440).risk.flattenMinute).toBeNull();
  });
  it("displays archived results without rewriting their original settings", () => {
    const config = {
      entry: "pullback",
      initialCapital: 10000,
      tickSize: 0.1,
      quantityStep: 0.001,
      feeBps: 5,
      slippageBps: 2,
      fastEma: 20,
      slowEma: 60,
      trendMinutes: 5,
      breakEvenR: 1,
      trailingStartR: 2,
    } as ArchivedTrendConfig;
    validateRecordedTrendConfig(config);
    const before = JSON.stringify(config);
    const view = trendRunView({ config } as TrendRun);
    expect(view.archived).toBe(true);
    expect(view.tradeMinutes).toBe(1);
    expect(view.filter).toContain("5 分钟");
    expect(JSON.stringify(config)).toBe(before);
    expect(() => validateTrendConfig(config)).toThrow();
  });
});
