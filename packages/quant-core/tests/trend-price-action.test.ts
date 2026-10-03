import { describe, expect, it } from "vitest";
import {
  createTrendConfig,
  kdjResearchConfig,
  priceActionResearchConfig,
  restoreTrendDraft,
  trendRunView,
  trendWarmupDays,
  validateRecordedTrendConfig,
  validateTrendConfig,
  withTradingPeriod,
  withTrendEntry,
  withTrendManagement,
  type TrendRun,
} from "../src/trend";
import { RECORDED_V6 } from "./fixtures/trend-recorded";

describe("price-action research contract", () => {
  it("preserves user execution and risk policy while setting only the declared hypothesis", () => {
    const original = createTrendConfig();
    original.execution.initialCapital = 17000;
    original.execution.slippageBps = 4;
    original.risk.riskPct = 0.003;
    original.strategy.maxCostAtr = 0.75;
    const before = structuredClone(original);
    const next = priceActionResearchConfig(original);
    validateTrendConfig(next);
    expect(next.strategy).toMatchObject({
      entry: "price-action",
      filter: "slow-ema",
      management: "staged",
      staged: { breakEvenR: 1, trailingStartR: 2 },
      priceAction: { keyLevel: true, twoLegs: true },
      direction: "both",
      tradeMinutes: 5,
      stopAtr: 2,
      trailingAtr: 3,
      breakEvenAtr: 0,
      maxCostAtr: 0.75,
    });
    expect(next.execution).toEqual(original.execution);
    expect(next.risk).toEqual(original.risk);
    next.strategy.priceAction!.keyLevel = false;
    next.execution.feeBps = 2;
    expect(original).toEqual(before);
    expect(createTrendConfig().strategy).toMatchObject({
      entry: "breakout",
      filter: "background",
      direction: "long",
      tradeMinutes: 240,
      management: "channel",
    });
  });

  it("requires both boolean mechanisms only for price-action and keeps warmup equal across ablations", () => {
    const base = priceActionResearchConfig(createTrendConfig());
    for (const keyLevel of [false, true])
      for (const twoLegs of [false, true]) {
        base.strategy.priceAction = { keyLevel, twoLegs };
        for (const [minutes, days] of [
          [5, 1],
          [60, 4],
          [240, 22],
          [1440, 154],
        ]) {
          const next = withTradingPeriod(base, minutes!);
          next.strategy.filter = "none";
          validateTrendConfig(next);
          expect(trendWarmupDays(next)).toBe(days);
        }
      }
    for (const priceAction of [
      undefined,
      null,
      {},
      { keyLevel: true },
      { keyLevel: 1, twoLegs: true },
      { keyLevel: true, twoLegs: true, period: 2 },
    ]) {
      expect(() =>
        validateTrendConfig({ ...base, strategy: { ...base.strategy, priceAction } }),
      ).toThrow();
    }
    for (const entry of ["breakout", "pullback", "kdj"])
      expect(() =>
        validateTrendConfig({ ...base, strategy: { ...base.strategy, entry } }),
      ).toThrow();
  });

  it("removes inactive mechanism fields when switching entry or forcing channel management", () => {
    const base = priceActionResearchConfig(createTrendConfig());
    base.strategy.priceAction!.keyLevel = false;
    expect(withTrendEntry(base, "price-action").strategy.priceAction).toEqual({
      keyLevel: false,
      twoLegs: true,
    });
    for (const entry of ["kdj", "pullback", "breakout"] as const) {
      const next = withTrendEntry(base, entry);
      validateTrendConfig(next);
      expect(next.strategy).not.toHaveProperty("priceAction");
    }
    const channel = withTrendManagement(base, "channel");
    validateTrendConfig(channel);
    expect(channel.strategy.entry).toBe("breakout");
    expect(channel.strategy).not.toHaveProperty("priceAction");
    expect(channel.strategy).not.toHaveProperty("staged");
    expect(kdjResearchConfig(base).strategy).not.toHaveProperty("priceAction");
    const view = trendRunView({ config: base } as TrendRun);
    expect(view.channelConfig).toBeUndefined();
    expect(view.priceAction).toEqual(base.strategy.priceAction);
  });

  it("upgrades only the v6 draft, retaining its KDJ and staged semantics and frozen rule identity", () => {
    const old = structuredClone(RECORDED_V6);
    const before = structuredClone(old);
    validateRecordedTrendConfig(old);
    expect(() => validateTrendConfig(old)).toThrow();
    const next = restoreTrendDraft(old);
    expect(next).toEqual({ ...old, version: 10 });
    expect(trendRunView({ config: old } as TrendRun)).toMatchObject({
      ruleVersion: 7,
      staged: true,
      entry: "kdj",
    });
    next.strategy.staged!.breakEvenR = 0;
    expect(old).toEqual(before);
    for (const patch of [
      { entry: "price-action" },
      { priceAction: { keyLevel: true, twoLegs: true } },
      { staged: { breakEvenR: NaN, trailingStartR: 2 } },
      { staged: { breakEvenR: 0, trailingStartR: 21 } },
      { staged: undefined },
      { management: "atr" },
    ])
      expect(() =>
        validateRecordedTrendConfig({ ...old, strategy: { ...old.strategy, ...patch } }),
      ).toThrow();
    validateRecordedTrendConfig({
      ...old,
      strategy: { ...old.strategy, staged: { breakEvenR: 20, trailingStartR: 0 } },
    });
  });
});
