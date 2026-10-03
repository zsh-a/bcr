import { describe, expect, it, vi } from "vitest";
import * as executableConfig from "../src/trend/config";
import {
  createTrendConfig,
  defaultTrendPreset,
  priceActionResearchConfig,
  restoreTrendDraft,
  structuredPullbackResearchConfig,
  trendRunView,
  trendWarmupDays,
  validateRecordedTrendConfig,
  validateTrendConfig,
  withTradingPeriod,
  withTrendEntry,
  withTrendManagement,
  type TrendRun,
} from "../src/trend";
import { RECORDED_V6, RECORDED_V7, RECORDED_V8, RECORDED_V9 } from "./fixtures/trend-recorded";

describe("structured pullback executable and historical contracts", () => {
  it("sets the declared 30-minute hypothesis without replacing default or PA rules", () => {
    const input = createTrendConfig();
    input.execution.initialCapital = 12345;
    input.execution.slippageBps = 4;
    input.strategy.maxCostAtr = 0.4;
    input.risk.riskPct = 0.003;
    const frozen = structuredClone(input);
    const config = structuredPullbackResearchConfig(input);
    validateTrendConfig(config);
    expect(config.version).toBe(10);
    expect(config.strategy).toMatchObject({
      entry: "structured-pullback",
      filter: "ema",
      tradeMinutes: 30,
      management: "chandelier",
      structuredPullback: {
        keyLevel: "either",
        shape: "any",
        candle: "none",
        confirmation: "before-breakout",
        keyRole: "pullback-retest",
      },
      direction: "both",
      stopAtr: 2,
      trailingAtr: 3,
      breakEvenAtr: 0,
      maxCostAtr: 0.4,
    });
    expect(config.strategy).not.toHaveProperty("staged");
    expect(config.execution).toEqual(input.execution);
    expect(config.risk).toEqual({ ...input.risk, dailyLossPct: 0 });
    expect(input).toEqual(frozen);
    expect(createTrendConfig().strategy).toMatchObject({
      entry: "breakout",
      tradeMinutes: 240,
      management: "channel",
      filter: "background",
    });
    expect(priceActionResearchConfig(input).strategy).toMatchObject({
      entry: "price-action",
      tradeMinutes: 5,
      filter: "slow-ema",
      management: "staged",
      staged: { breakEvenR: 1, trailingStartR: 2 },
      priceAction: { keyLevel: true, twoLegs: true },
    });
    expect(priceActionResearchConfig(input).risk).toEqual(input.risk);
  });

  it("requires exactly the declared mechanism choices and rejects fields in inactive modes", () => {
    const config = structuredPullbackResearchConfig(createTrendConfig());
    for (const structuredPullback of [
      undefined,
      null,
      {},
      { keyLevel: "either", shape: "any" },
      { keyLevel: true, shape: "any", candle: "none" },
      { keyLevel: "either", shape: "all", candle: "none" },
      { keyLevel: "either", shape: "any", candle: "doji" },
      { keyLevel: "either", shape: "any", candle: "none", tolerance: 1 },
    ])
      expect(() =>
        validateTrendConfig({ ...config, strategy: { ...config.strategy, structuredPullback } }),
      ).toThrow();
    for (const entry of ["breakout", "pullback", "kdj", "price-action"])
      expect(() =>
        validateTrendConfig({ ...config, strategy: { ...config.strategy, entry } }),
      ).toThrow();
    for (const patch of [
      { staged: { breakEvenR: 0, trailingStartR: 0 } },
      { breakEvenAtr: 1 },
      { channelExitBars: 20 },
      { breakoutReentry: "episode" },
    ])
      expect(() =>
        validateTrendConfig({ ...config, strategy: { ...config.strategy, ...patch } }),
      ).toThrow();
    for (const keyLevel of ["none", "pivot", "validated-ema", "either"] as const)
      for (const shape of ["none", "any", "two-legs", "wedge", "channel", "double-test"] as const)
        for (const candle of ["none", "reversal"] as const)
          for (const confirmation of ["before-breakout", "signal-close"] as const)
            for (const keyRole of ["pullback-retest", "impulse-context"] as const)
              validateTrendConfig({
                ...config,
                strategy: {
                  ...config.strategy,
                  structuredPullback: { keyLevel, shape, candle, confirmation, keyRole },
                },
              });
  });

  it("uses identical full context warmup across all ablations and preserves prior warmup limits", () => {
    const config = structuredPullbackResearchConfig(createTrendConfig());
    for (const keyLevel of ["none", "pivot", "validated-ema", "either"] as const) {
      config.strategy.structuredPullback!.keyLevel = keyLevel;
      config.strategy.filter = "none";
      for (const [minutes, days] of [
        [5, 1],
        [30, 4],
        [60, 7],
        [240, 42],
      ]) {
        const next = withTradingPeriod(config, minutes!);
        expect(trendWarmupDays(next)).toBe(days);
        validateTrendConfig(next);
      }
    }
    const daily = withTradingPeriod(config, 1440);
    expect(trendWarmupDays(daily)).toBe(294);
    expect(() => validateTrendConfig(daily)).toThrow("250");
  });

  it("clears inactive fields on entry and management transitions", () => {
    const config = structuredPullbackResearchConfig(createTrendConfig());
    config.strategy.structuredPullback!.shape = "wedge";
    const retained = withTrendEntry(config, "structured-pullback");
    retained.strategy.structuredPullback!.shape = "double-test";
    expect(config.strategy.structuredPullback!.shape).toBe("wedge");
    for (const entry of ["breakout", "pullback", "kdj", "price-action"] as const) {
      const next = withTrendEntry(config, entry);
      validateTrendConfig(next);
      expect(next.strategy).not.toHaveProperty("structuredPullback");
    }
    const pa = priceActionResearchConfig(config);
    const switched = withTrendEntry(pa, "structured-pullback");
    expect(switched.strategy).not.toHaveProperty("priceAction");
    validateTrendConfig(switched);
    const continuous = withTrendManagement(pa, "chandelier");
    expect(continuous.strategy).not.toHaveProperty("staged");
    expect(continuous.strategy.breakEvenAtr).toBe(0);
    validateTrendConfig(continuous);
    for (const next of [withTrendManagement(config, "channel"), defaultTrendPreset(config)]) {
      validateTrendConfig(next);
      expect(next.strategy.entry).toBe("breakout");
      expect(next.strategy).not.toHaveProperty("structuredPullback");
    }
    expect(trendRunView({ config } as TrendRun)).toMatchObject({
      ruleVersion: 11,
      label: "结构化回调研究",
      management: "连续动态 ATR 跟踪 · 无保本门槛",
      structuredPullback: config.strategy.structuredPullback,
    });
  });

  it("freezes v9 semantics and migrates only drafts to explicit legacy choices", () => {
    const old = structuredClone(RECORDED_V9);
    const bytes = JSON.stringify(old);
    const validator = vi.spyOn(executableConfig, "validateTrendConfig").mockImplementation(() => {
      throw new Error("future schema");
    });
    try {
      validateRecordedTrendConfig(old);
      expect(validator).not.toHaveBeenCalled();
    } finally {
      validator.mockRestore();
    }
    const draft = restoreTrendDraft(old);
    expect(draft.version).toBe(10);
    expect(draft.strategy.structuredPullback).toEqual({
      ...old.strategy.structuredPullback,
      confirmation: "before-breakout",
      keyRole: "pullback-retest",
    });
    expect(trendRunView({ config: old } as TrendRun).ruleVersion).toBe(10);
    for (const patch of [
      { confirmation: "signal-close" },
      { keyRole: "impulse-context" },
      { confirmation: null },
      { shape: "unknown" },
    ])
      expect(() =>
        validateRecordedTrendConfig({
          ...old,
          strategy: {
            ...old.strategy,
            structuredPullback: { ...old.strategy.structuredPullback, ...patch },
          },
        }),
      ).toThrow();
    for (const patch of [
      { breakEvenAtr: 1 },
      { tradeMinutes: 1440 },
      { staged: { breakEvenR: 0, trailingStartR: 0 } },
    ])
      expect(() =>
        validateRecordedTrendConfig({ ...old, strategy: { ...old.strategy, ...patch } }),
      ).toThrow();
    for (const key of ["confirmation", "keyRole"] as const) {
      for (const value of [undefined, null, "unknown"]) {
        const corrupt = structuredClone(draft);
        Object.assign(corrupt.strategy.structuredPullback!, { [key]: value });
        expect(() => validateTrendConfig(corrupt)).toThrow();
      }
    }
    draft.strategy.structuredPullback!.confirmation = "signal-close";
    draft.strategy.structuredPullback!.keyRole = "impulse-context";
    expect(restoreTrendDraft(draft)).toEqual(draft);
    expect(JSON.stringify(old)).toBe(bytes);
  });

  it("validates v8 independently and upgrades only its editable draft", () => {
    const old = structuredClone(RECORDED_V8);
    const bytes = JSON.stringify(old);
    const validator = vi.spyOn(executableConfig, "validateTrendConfig").mockImplementation(() => {
      throw new Error("future schema");
    });
    try {
      validateRecordedTrendConfig(old);
      expect(validator).not.toHaveBeenCalled();
    } finally {
      validator.mockRestore();
    }
    for (const source of [RECORDED_V6, RECORDED_V7]) {
      const archived = { ...structuredClone(source), version: 8 as const };
      validateRecordedTrendConfig(archived);
      expect(restoreTrendDraft(archived)).toEqual({ ...archived, version: 10 });
    }
    expect(() => validateTrendConfig(old)).toThrow();
    const current = restoreTrendDraft(old);
    expect(current).toEqual({ ...old, version: 10 });
    current.strategy.channelExitBars = 20;
    expect(JSON.stringify(old)).toBe(bytes);
    expect(trendRunView({ config: old } as TrendRun)).toMatchObject({
      ruleVersion: 9,
      channelConfig: { tradeMinutes: 30, entryBars: 320, exitBars: 160 },
    });
    for (const patch of [
      { structuredPullback: { keyLevel: "none", shape: "none", candle: "none" } },
      { entry: "structured-pullback" },
      { management: "chandelier" },
      { breakoutBars: 1001 },
      { channelExitBars: undefined },
      { breakoutReentry: "once" },
      { tradeMinutes: 1440, breakoutBars: 251 },
    ])
      expect(() =>
        validateRecordedTrendConfig({ ...old, strategy: { ...old.strategy, ...patch } }),
      ).toThrow();
  });
});
