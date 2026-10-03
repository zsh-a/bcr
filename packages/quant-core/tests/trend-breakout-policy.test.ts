import { cacheKey } from "@bcr/core";
import { describe, expect, it } from "vitest";
import {
  channelExitBars,
  createTrendConfig,
  defaultTrendPreset,
  managementLabel,
  restoreTrendDraft,
  trendRunView,
  trendWarmupDays,
  validateRecordedTrendConfig,
  validateTrendConfig,
  withTrendEntry,
  withTrendManagement,
  type TrendConfig,
  type TrendRun,
} from "../src/trend";
import { RECORDED_V4, RECORDED_V5, RECORDED_V6, RECORDED_V7 } from "./fixtures/trend-recorded";

function research(patch: Partial<TrendConfig["strategy"]> = {}): TrendConfig {
  const config = createTrendConfig();
  Object.assign(config.strategy, { tradeMinutes: 30, filter: "none", breakoutBars: 40 }, patch);
  return config;
}

describe("independent breakout entry, exit and reentry policies", () => {
  it("keeps omitted exit/reentry options identical to the old windows and leaves defaults unchanged", () => {
    const config = createTrendConfig();
    expect(config.version).toBe(10);
    expect(config.strategy).not.toHaveProperty("channelExitBars");
    expect(config.strategy).not.toHaveProperty("breakoutReentry");
    expect(config.strategy).toMatchObject({
      tradeMinutes: 240,
      breakoutBars: 20,
      filter: "background",
      direction: "long",
    });
    expect(channelExitBars(config.strategy)).toBe(10);
    expect(channelExitBars(research({ breakoutBars: 41 }).strategy)).toBe(20);
    expect(trendWarmupDays(config)).toBe(22);
    expect(managementLabel(config.strategy)).toBe("反向 10 根通道退出");
  });

  it.each([
    [{ breakoutBars: 40, channelExitBars: 20 }, 1],
    [{ breakoutBars: 320, channelExitBars: 20 }, 7],
    [{ breakoutBars: 40, channelExitBars: 320 }, 7],
    [{ breakoutBars: 40, channelExitBars: 40, breakoutReentry: "episode" }, 1],
    [{ tradeMinutes: 1440, breakoutBars: 250, channelExitBars: 250 }, 250],
  ] as const)("uses active entry and exit windows for %o", (patch, days) => {
    const config = research(patch);
    validateTrendConfig(config);
    expect(trendWarmupDays(config)).toBe(days);
    const view = trendRunView({ config } as TrendRun);
    expect(view.channelConfig).toEqual({
      tradeMinutes: config.strategy.tradeMinutes,
      entryBars: patch.breakoutBars,
      exitBars: patch.channelExitBars,
    });
    expect(view.management).toBe(`反向 ${patch.channelExitBars} 根通道退出`);
    expect(view.ruleVersion).toBe(11);
  });

  it("rejects inactive options, invalid values and windows requiring more than 250 days", () => {
    const patches: Record<string, unknown>[] = [
      { breakoutBars: 1001 },
      { breakoutBars: 1 },
      { channelExitBars: 0 },
      { channelExitBars: 1.5 },
      { channelExitBars: 1001 },
      { channelExitBars: null },
      { channelExitBars: undefined },
      { breakoutReentry: null },
      { breakoutReentry: undefined },
      { breakoutReentry: "once" },
      { management: "atr", channelExitBars: 20 },
      { management: "atr", entry: "pullback", breakoutReentry: "every-close" },
      { tradeMinutes: 1440, breakoutBars: 251 },
      { tradeMinutes: 1440, channelExitBars: 251 },
    ];
    for (const patch of patches) {
      const config = research();
      Object.assign(config.strategy, patch);
      expect(() => validateTrendConfig(config), JSON.stringify(patch)).toThrow();
    }
    validateTrendConfig(research({ breakoutBars: 1000, channelExitBars: 1000 }));
    // Dormant entry windows do not require history for non-breakout rules.
    validateTrendConfig(
      research({ entry: "pullback", management: "atr", tradeMinutes: 1440, breakoutBars: 1000 }),
    );
  });

  it("removes conditional options when switching modes and when applying an existing preset", () => {
    const original = research({ channelExitBars: 40, breakoutReentry: "episode" });
    const atr = withTrendManagement(original, "atr");
    expect(atr.strategy).not.toHaveProperty("channelExitBars");
    expect(atr.strategy.breakoutReentry).toBe("episode");
    validateTrendConfig(atr);
    const pullback = withTrendEntry(atr, "pullback");
    expect(pullback.strategy).not.toHaveProperty("breakoutReentry");
    validateTrendConfig(pullback);
    const channel = withTrendManagement(pullback, "channel");
    expect(channel.strategy.entry).toBe("breakout");
    expect(channel.strategy).not.toHaveProperty("channelExitBars");
    expect(channelExitBars(channel.strategy)).toBe(20);
    validateTrendConfig(channel);
    const preset = defaultTrendPreset(original);
    expect(preset.strategy).not.toHaveProperty("channelExitBars");
    expect(preset.strategy).not.toHaveProperty("breakoutReentry");
    expect(original.strategy.channelExitBars).toBe(40);
    expect(original.strategy.breakoutReentry).toBe("episode");
  });

  it("freezes v7 price action and rejects new policy fields or larger windows in every old contract", () => {
    const old = structuredClone(RECORDED_V7);
    const bytes = JSON.stringify(old);
    validateRecordedTrendConfig(old);
    expect(() => validateTrendConfig(old)).toThrow();
    const draft = restoreTrendDraft(old);
    expect(draft).toEqual({ ...old, version: 10 });
    expect(trendRunView({ config: old } as TrendRun)).toMatchObject({
      ruleVersion: 8,
      staged: true,
      priceAction: { keyLevel: true, twoLegs: false },
    });
    draft.strategy.priceAction!.keyLevel = false;
    expect(JSON.stringify(old)).toBe(bytes);
    for (const fixture of [RECORDED_V4, RECORDED_V5, RECORDED_V6, RECORDED_V7])
      for (const patch of [
        { channelExitBars: 10 },
        { channelExitBars: null },
        { breakoutReentry: "every-close" },
        { breakoutReentry: null },
        { breakoutBars: 251 },
      ])
        expect(() =>
          validateRecordedTrendConfig({ ...fixture, strategy: { ...fixture.strategy, ...patch } }),
        ).toThrow();
    for (const patch of [
      { priceAction: undefined },
      { priceAction: { keyLevel: 1, twoLegs: false } },
      { entry: "kdj" },
    ])
      expect(() =>
        validateRecordedTrendConfig({ ...old, strategy: { ...old.strategy, ...patch } }),
      ).toThrow();
  });

  it("preserves optional policies through JSON and draft restore with distinct cache identities", () => {
    const base = research();
    const exit = research({ channelExitBars: 40 });
    const episode = research({ breakoutReentry: "episode" });
    expect(trendRunView({ config: episode } as TrendRun).label).toContain("每个突破阶段仅首次机会");
    expect(trendRunView({ config: base } as TrendRun).label).not.toContain("阶段");
    const key = (config: TrendConfig) =>
      cacheKey({
        operation: "quant.trend",
        inputs: [],
        config: { strategy: config },
        runtimeVersion: "trend-continuation-14",
      });
    const keys = [base, exit, episode].map(key);
    expect(new Set(keys).size).toBe(3);
    for (const config of [base, exit, episode]) {
      const restored = restoreTrendDraft(JSON.parse(JSON.stringify(config)));
      expect(restored).toEqual(config);
      expect(key(restored)).toBe(key(config));
    }
  });
});
