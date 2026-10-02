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
  type RecordedTrendConfigV2,
  backgroundMinutes,
  restoreTrendDraft,
} from "../src/trend";

describe("trend research configuration", () => {
  it("defaults to causal background filtering with consistent ATR exits and continuous holding", () => {
    validateTrendConfig(DEFAULT_TREND_CONFIG);
    expect(DEFAULT_TREND_CONFIG.strategy.entry).toBe("breakout");
    expect(DEFAULT_TREND_CONFIG.strategy.filter).toBe("background");
    expect(DEFAULT_TREND_CONFIG.version).toBe(3);
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
      { ...DEFAULT_TREND_CONFIG, version: 2 },
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
    expect(trendWarmupDays(hourly)).toBe(4);
    hourly.strategy.filter = "none";
    expect(trendWarmupDays(hourly)).toBe(1);
    hourly.strategy.filter = "ema";
    expect(trendWarmupDays(hourly)).toBe(3);
    const daily = withTradingPeriod(DEFAULT_TREND_CONFIG, 1440);
    expect(trendWarmupDays(daily)).toBe(154);
    daily.strategy.filter = "none";
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
  it("maps every trading period to a larger context without exceeding the warmup limit", () => {
    expect(TREND_PERIODS.map(backgroundMinutes)).toEqual([
      5, 15, 30, 60, 120, 240, 720, 1440, 10080,
    ]);
    for (const period of TREND_PERIODS) {
      expect(backgroundMinutes(period)).toBeGreaterThan(period);
      expect(trendWarmupDays(withTradingPeriod(DEFAULT_TREND_CONFIG, period))).toBeLessThanOrEqual(
        250,
      );
    }
    expect(() => backgroundMinutes(7)).toThrow();
  });
  it("upgrades only v2 drafts and keeps recorded runs and their rule labels immutable", () => {
    const old = {
      ...createTrendConfig(),
      version: 2,
      strategy: { ...DEFAULT_TREND_CONFIG.strategy, filter: "none" },
    } as RecordedTrendConfigV2;
    const original = JSON.stringify(old);
    validateRecordedTrendConfig(old);
    expect(() => validateTrendConfig(old)).toThrow();
    expect(trendRunView({ config: old } as TrendRun).ruleVersion).toBe(3);
    const draft = restoreTrendDraft(old);
    validateTrendConfig(draft);
    expect(draft.strategy.filter).toBe("none");
    draft.execution.feeBps = 1;
    expect(JSON.stringify(old)).toBe(original);
    expect(trendRunView({ config: createTrendConfig() } as TrendRun).ruleVersion).toBe(4);
    expect(() =>
      validateRecordedTrendConfig({ ...old, strategy: { ...old.strategy, filter: "background" } }),
    ).toThrow();
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
