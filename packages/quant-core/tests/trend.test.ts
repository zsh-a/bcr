import { describe, expect, it, vi } from "vitest";
import * as executableConfig from "../src/trend/config";
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
  backgroundMinutes,
  restoreTrendDraft,
  simpleChannelConfig,
  type RecordedTrendConfigV4,
} from "../src/trend";
import { RECORDED_V2, RECORDED_V3, RECORDED_V4 } from "./fixtures/trend-recorded";

describe("trend research configuration", () => {
  it("defaults to the slow long-only research candidate with an independent disabled cost gate", () => {
    validateTrendConfig(DEFAULT_TREND_CONFIG);
    expect(DEFAULT_TREND_CONFIG.strategy.entry).toBe("breakout");
    expect(DEFAULT_TREND_CONFIG.strategy).toMatchObject({
      filter: "none",
      maxCostAtr: 0,
      management: "channel",
      direction: "long",
      tradeMinutes: 240,
      breakoutBars: 20,
      stopAtr: 2,
      breakEvenAtr: 0,
    });
    expect(DEFAULT_TREND_CONFIG.version).toBe(5);
    expect(DEFAULT_TREND_CONFIG.risk.flattenMinute).toBeNull();
    const copy = createTrendConfig();
    copy.strategy.stopAtr = 3;
    copy.risk.riskPct = 0.01;
    expect(DEFAULT_TREND_CONFIG.strategy.stopAtr).toBe(2);
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
      ["strategy", "maxCostAtr", -0.1],
      ["strategy", "maxCostAtr", 20.1],
      ["strategy", "maxCostAtr", NaN],
      ["strategy", "maxCostAtr", Infinity],
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
    hourly.strategy.filter = "background";
    expect(trendWarmupDays(hourly)).toBe(4);
    hourly.strategy.filter = "none";
    expect(trendWarmupDays(hourly)).toBe(1);
    hourly.strategy.filter = "ema";
    expect(trendWarmupDays(hourly)).toBe(3);
    const daily = withTradingPeriod(DEFAULT_TREND_CONFIG, 1440);
    daily.strategy.filter = "background";
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
      const config = withTradingPeriod(DEFAULT_TREND_CONFIG, period);
      config.strategy.filter = "background";
      expect(trendWarmupDays(config)).toBeLessThanOrEqual(250);
    }
    expect(() => backgroundMinutes(7)).toThrow();
  });
  it("upgrades only v2 drafts and keeps recorded runs and their rule labels immutable", () => {
    const old = structuredClone(RECORDED_V2);
    const original = JSON.stringify(old);
    validateRecordedTrendConfig(old);
    expect(() => validateTrendConfig(old)).toThrow();
    expect(trendRunView({ config: old } as TrendRun).ruleVersion).toBe(3);
    const draft = restoreTrendDraft(old);
    validateTrendConfig(draft);
    expect(draft.strategy.filter).toBe("none");
    draft.execution.feeBps = 1;
    expect(JSON.stringify(old)).toBe(original);
    expect(trendRunView({ config: createTrendConfig() } as TrendRun).ruleVersion).toBe(6);
    expect(() =>
      validateRecordedTrendConfig({ ...old, strategy: { ...old.strategy, filter: "background" } }),
    ).toThrow();
  });
  it("preserves v3 frozen rules and only upgrades their editable draft to ATR management", () => {
    const old = structuredClone(RECORDED_V3);
    const frozen = JSON.stringify(old);
    validateRecordedTrendConfig(old);
    expect(trendRunView({ config: old } as TrendRun).ruleVersion).toBe(4);
    expect(restoreTrendDraft(old).strategy.management).toBe("atr");
    expect(restoreTrendDraft(old).strategy.maxCostAtr).toBe(0.5);
    expect(JSON.stringify(old)).toBe(frozen);
  });
  it("upgrades v4 editable drafts without changing strategy, execution, risk or frozen records", () => {
    for (const filter of ["none", "ema", "background"] as const) {
      const old: RecordedTrendConfigV4 = {
        ...structuredClone(RECORDED_V4),
        strategy: {
          ...RECORDED_V4.strategy,
          filter,
          tradeMinutes: 1,
          management: filter === "none" ? "channel" : "atr",
          direction: "both",
          stopAtr: 1.5,
          breakEvenAtr: 1.5,
        },
        execution: { ...RECORDED_V4.execution, initialCapital: 23000, feeBps: 7 },
        risk: { ...RECORDED_V4.risk, riskPct: 0.003 },
      };
      const frozen = JSON.stringify(old);
      validateRecordedTrendConfig(old);
      expect(() => validateTrendConfig(old)).toThrow();
      expect(trendRunView({ config: old } as TrendRun).ruleVersion).toBe(5);
      expect(trendRunView({ config: old } as TrendRun).channel).toBe(filter === "none");
      const draft = restoreTrendDraft(old);
      validateTrendConfig(draft);
      expect(draft.version).toBe(5);
      expect(draft.strategy).toEqual({
        ...old.strategy,
        maxCostAtr: filter === "background" ? 0.5 : 0,
      });
      expect(draft.execution).toEqual(old.execution);
      expect(draft.risk).toEqual(old.risk);
      draft.execution.initialCapital = 1;
      expect(JSON.stringify(old)).toBe(frozen);
      expect(() =>
        validateRecordedTrendConfig({
          ...old,
          strategy: { ...old.strategy, maxCostAtr: 0.5 },
        }),
      ).toThrow();
    }
  });
  it("validates historical fields with their own frozen schema and limits", () => {
    for (const fixture of [RECORDED_V2, RECORDED_V3, RECORDED_V4]) {
      validateRecordedTrendConfig(fixture);
      const boundary = structuredClone(fixture);
      boundary.strategy.breakoutBars = 250;
      boundary.strategy.stopAtr = 20;
      boundary.risk.riskPct = 0.05;
      validateRecordedTrendConfig(boundary);
      for (const patch of [{ breakoutBars: 251 }, { stopAtr: 21 }, { maxCostAtr: 0 }])
        expect(() =>
          validateRecordedTrendConfig({
            ...fixture,
            strategy: { ...fixture.strategy, ...patch },
          }),
        ).toThrow();
      expect(() =>
        validateRecordedTrendConfig({ ...fixture, risk: { ...fixture.risk, riskPct: 0.051 } }),
      ).toThrow();
    }
  });
  it("keeps historical records readable if the current executable validator changes", () => {
    const validator = vi.spyOn(executableConfig, "validateTrendConfig").mockImplementation(() => {
      throw new Error("future executable rule");
    });
    try {
      for (const fixture of [RECORDED_V2, RECORDED_V3, RECORDED_V4])
        expect(() => validateRecordedTrendConfig(fixture)).not.toThrow();
      expect(validator).not.toHaveBeenCalled();
      expect(() => validateRecordedTrendConfig(createTrendConfig())).toThrow(
        "future executable rule",
      );
    } finally {
      validator.mockRestore();
    }
  });
  it("keeps the explicit cost gate independent of filtering and preserves v5 drafts", () => {
    for (const filter of ["none", "ema", "background"] as const) {
      for (const maxCostAtr of [0, 0.5, 20]) {
        const config = createTrendConfig();
        Object.assign(config.strategy, { filter, maxCostAtr });
        validateTrendConfig(config);
        expect(restoreTrendDraft(config)).toEqual(config);
        expect(trendRunView({ config } as TrendRun).costFilter).toBe(
          maxCostAtr ? `往返成本 ≤ ${maxCostAtr} ATR` : "成本门槛关闭",
        );
      }
    }
  });
  it("uses an independent simple channel preset without changing costs or risk", () => {
    const config = createTrendConfig();
    config.strategy.management = "atr";
    config.strategy.maxCostAtr = 0.5;
    config.execution.feeBps = 6;
    const simple = simpleChannelConfig(config);
    validateTrendConfig(simple);
    expect(simple.strategy).toMatchObject({
      management: "channel",
      direction: "long",
      tradeMinutes: 240,
      filter: "none",
      maxCostAtr: 0,
      breakoutBars: 20,
      stopAtr: 2,
      breakEvenAtr: 0,
    });
    expect(simple.execution).toEqual(config.execution);
    expect(simple.risk).toEqual(config.risk);
    expect(config.strategy.management).toBe("atr");
    simple.strategy.entry = "pullback";
    expect(() => validateTrendConfig(simple)).toThrow();
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
