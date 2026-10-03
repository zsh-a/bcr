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
  defaultTrendPreset,
  simpleChannelConfig,
  kdjResearchConfig,
  withTrendManagement,
  type RecordedTrendConfigV4,
} from "../src/trend";
import {
  RECORDED_V2,
  RECORDED_V3,
  RECORDED_V4,
  RECORDED_V5,
  RECORDED_V6,
  RECORDED_V7,
} from "./fixtures/trend-recorded";

describe("trend research configuration", () => {
  it("defaults to daily background filtering on the slow long-only candidate with an independent disabled cost gate", () => {
    validateTrendConfig(DEFAULT_TREND_CONFIG);
    expect(DEFAULT_TREND_CONFIG.strategy.entry).toBe("breakout");
    expect(DEFAULT_TREND_CONFIG.strategy).toMatchObject({
      filter: "background",
      maxCostAtr: 0,
      management: "channel",
      direction: "long",
      tradeMinutes: 240,
      breakoutBars: 20,
      stopAtr: 2,
      breakEvenAtr: 0,
    });
    expect(DEFAULT_TREND_CONFIG.version).toBe(10);
    expect(DEFAULT_TREND_CONFIG.risk.flattenMinute).toBeNull();
    expect(trendWarmupDays(DEFAULT_TREND_CONFIG)).toBe(22);
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
    daily.strategy.management = "atr";
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
    expect(trendRunView({ config: createTrendConfig() } as TrendRun).ruleVersion).toBe(11);
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
      expect(draft.version).toBe(10);
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
      for (const fixture of [
        RECORDED_V2,
        RECORDED_V3,
        RECORDED_V4,
        RECORDED_V5,
        RECORDED_V6,
        RECORDED_V7,
      ])
        expect(() => validateRecordedTrendConfig(fixture)).not.toThrow();
      expect(validator).not.toHaveBeenCalled();
      expect(() => validateRecordedTrendConfig(createTrendConfig())).toThrow(
        "future executable rule",
      );
    } finally {
      validator.mockRestore();
    }
  });
  it("keeps the explicit cost gate independent of filtering and preserves current drafts", () => {
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
  it("upgrades v5 drafts without changing their frozen strategy, costs or history", () => {
    const old = structuredClone(RECORDED_V5);
    const before = JSON.stringify(old);
    validateRecordedTrendConfig(old);
    expect(() => validateTrendConfig(old)).toThrow();
    const current = restoreTrendDraft(old);
    expect(current).toEqual({ ...old, version: 10 });
    expect(trendRunView({ config: old } as TrendRun).ruleVersion).toBe(6);
    current.strategy.stopAtr = 9;
    expect(JSON.stringify(old)).toBe(before);
    for (const patch of [
      { entry: "kdj" },
      { filter: "slow-ema" },
      { management: "staged", staged: { breakEvenR: 1, trailingStartR: 2 } },
      { maxCostAtr: 21 },
    ])
      expect(() =>
        validateRecordedTrendConfig({ ...old, strategy: { ...old.strategy, ...patch } }),
      ).toThrow();
  });
  it("builds the screenshot hypothesis while preserving execution, capital, risk and cost policy", () => {
    const original = createTrendConfig();
    original.execution.feeBps = 9;
    original.execution.initialCapital = 23000;
    original.risk.dailyLossPct = 0.02;
    original.strategy.maxCostAtr = 0.6;
    const research = kdjResearchConfig(original);
    validateTrendConfig(research);
    expect(research.strategy).toMatchObject({
      entry: "kdj",
      filter: "slow-ema",
      management: "staged",
      direction: "both",
      tradeMinutes: 5,
      stopAtr: 2,
      trailingAtr: 3,
      maxCostAtr: 0.6,
      staged: { breakEvenR: 1, trailingStartR: 2 },
    });
    expect(research.execution).toEqual(original.execution);
    expect(research.risk).toEqual(original.risk);
    expect(trendRunView({ config: research } as TrendRun)).toMatchObject({
      label: "KDJ 回调研究",
      channelConfig: undefined,
      staged: true,
      slowEma: true,
    });
    research.execution.feeBps = 1;
    expect(original.execution.feeBps).toBe(9);
    expect(original.strategy.staged).toBeUndefined();
    expect(trendWarmupDays(withTradingPeriod(research, 1440))).toBe(63);
    expect(trendWarmupDays(withTradingPeriod(research, 240))).toBe(11);
    expect(trendWarmupDays(withTradingPeriod(research, 60))).toBe(3);
    research.strategy.filter = "none";
    expect(trendWarmupDays(withTradingPeriod(research, 1440))).toBe(14);
  });
  it("validates staged thresholds independently and removes them when changing management", () => {
    const research = kdjResearchConfig(createTrendConfig());
    for (const staged of [
      { breakEvenR: 0, trailingStartR: 0 },
      { breakEvenR: 20, trailingStartR: 1 },
    ])
      validateTrendConfig({ ...research, strategy: { ...research.strategy, staged } });
    for (const staged of [
      undefined,
      null,
      {},
      { breakEvenR: 1 },
      { breakEvenR: 1, trailingStartR: 2, other: 3 },
      { breakEvenR: NaN, trailingStartR: 2 },
      { breakEvenR: -1, trailingStartR: 2 },
      { breakEvenR: 1, trailingStartR: 21 },
    ])
      expect(() =>
        validateTrendConfig({ ...research, strategy: { ...research.strategy, staged } }),
      ).toThrow();
    expect(() =>
      validateTrendConfig({ ...research, strategy: { ...research.strategy, management: "atr" } }),
    ).toThrow();
    const atr = withTrendManagement(research, "atr");
    validateTrendConfig(atr);
    expect("staged" in atr.strategy).toBe(false);
    expect(atr.strategy.entry).toBe("kdj");
    const channel = withTrendManagement(research, "channel");
    validateTrendConfig(channel);
    expect(channel.strategy.entry).toBe("breakout");
    expect("staged" in channel.strategy).toBe(false);
    for (const entry of ["breakout", "pullback", "kdj"] as const)
      for (const filter of ["none", "ema", "background", "slow-ema"] as const)
        validateTrendConfig({ ...research, strategy: { ...research.strategy, entry, filter } });
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
      maxCostAtr: 0.5,
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
  it.each([0, 0.75])(
    "preserves capital, costs, risk and the %s ATR cost policy in both comparable presets",
    (maxCostAtr) => {
      const config = createTrendConfig();
      Object.assign(config.strategy, {
        entry: "pullback",
        filter: "ema",
        management: "atr",
        direction: "both",
        tradeMinutes: 60,
        breakoutBars: 40,
        stopAtr: 3,
        breakEvenAtr: 1,
        trailingAtr: 4,
        maxCostAtr,
      });
      Object.assign(config.execution, { initialCapital: 23000, feeBps: 7, slippageBps: 3 });
      Object.assign(config.risk, { riskPct: 0.003, cooldownMinutes: 240, flattenMinute: 1437 });
      const before = structuredClone(config);
      const filtered = defaultTrendPreset(config);
      const baseline = simpleChannelConfig(config);
      for (const preset of [filtered, baseline]) {
        validateTrendConfig(preset);
        expect(preset.execution).toEqual(before.execution);
        expect(preset.risk).toEqual(before.risk);
        expect(preset.strategy.maxCostAtr).toBe(maxCostAtr);
      }
      expect(filtered.strategy).toEqual({ ...DEFAULT_TREND_CONFIG.strategy, maxCostAtr });
      expect(baseline).toEqual({
        ...filtered,
        strategy: { ...filtered.strategy, filter: "none" },
      });
      expect(config).toEqual(before);
    },
  );
  it("keeps uncommitted preset drafts isolated so discarding them preserves applied settings", () => {
    const applied = simpleChannelConfig(createTrendConfig());
    const before = structuredClone(applied);
    const draft = defaultTrendPreset(applied);
    draft.strategy.breakoutBars = 40;
    draft.execution.initialCapital = 23000;
    draft.risk.riskPct = 0.003;
    expect(applied).toEqual(before);
    expect(structuredClone(applied).strategy.filter).toBe("none");
    expect(defaultTrendPreset(applied).strategy.breakoutBars).toBe(20);
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
  it("keeps early archived breakout records readable when their channel window is missing or invalid", () => {
    const recorded = {
      entry: "breakout",
      initialCapital: 10000,
      tickSize: 0.1,
      quantityStep: 0.001,
      feeBps: 5,
      slippageBps: 2,
      fastEma: 20,
      slowEma: 60,
      trendMinutes: 5,
    };
    for (const [breakoutBars, expectedWindow] of [
      [undefined, undefined],
      [null, undefined],
      [1, undefined],
      [2.5, undefined],
      [251, undefined],
      [NaN, undefined],
      [Infinity, undefined],
      ["20", undefined],
      [2, 2],
      [20, 20],
      [250, 250],
    ] as const) {
      const config = {
        ...recorded,
        ...(breakoutBars === undefined ? {} : { breakoutBars }),
      } as ArchivedTrendConfig;
      const before = structuredClone(config);
      validateRecordedTrendConfig(config);
      const view = trendRunView({ config } as TrendRun);
      expect(view).toMatchObject({
        archived: true,
        tradeMinutes: 1,
        label: "通道突破 · 旧版",
        initialCapital: 10000,
        tickSize: 0.1,
      });
      expect(view.execution).toEqual(before);
      expect(view.channelConfig).toEqual(
        expectedWindow === undefined
          ? undefined
          : { tradeMinutes: 1, entryBars: expectedWindow, exitBars: null },
      );
      expect(config).toEqual(before);
    }
  });
});
