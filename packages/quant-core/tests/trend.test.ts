import { describe, expect, it } from "vitest";
import {
  DEFAULT_TREND_CONFIG,
  TREND_PERIODS,
  normalizeTrendConfig,
  trendWarmupDays,
  withTradingPeriod,
  validateTrendConfig,
} from "../src/trend";
describe("trend research parameters", () => {
  it("supports both entries with the same bounded execution assumptions", () => {
    validateTrendConfig(DEFAULT_TREND_CONFIG);
    validateTrendConfig({ ...DEFAULT_TREND_CONFIG, entry: "breakout", flattenMinute: null });
  });
  it("rejects excessive exposure, inconsistent periods and exits", () => {
    for (const patch of [
      { riskPct: 0.5 },
      { maxExposurePct: 2 },
      { tradeMinutes: 15, trendMinutes: 5 },
      { tradeMinutes: 7 },
      { tradeMinutes: 1440, trendMinutes: 1440 },
      { breakEvenR: 3, trailingStartR: 2 },
      { minRetracement: 0.8, maxRetracement: 0.5 },
      { feeBps: NaN },
      { quantityStep: 0 },
    ])
      expect(() => validateTrendConfig({ ...DEFAULT_TREND_CONFIG, ...patch })).toThrow();
  });
  it("keeps windows in candles and expands historical warmup for larger periods", () => {
    for (const period of TREND_PERIODS)
      validateTrendConfig(withTradingPeriod(DEFAULT_TREND_CONFIG, period));
    expect(trendWarmupDays(DEFAULT_TREND_CONFIG)).toBe(1);
    const hourly = withTradingPeriod(DEFAULT_TREND_CONFIG, 60);
    expect(hourly.atrPeriod).toBe(14);
    expect(hourly.trendMinutes).toBe(60);
    expect(trendWarmupDays(hourly)).toBe(3);
    const daily = withTradingPeriod(DEFAULT_TREND_CONFIG, 1440);
    expect(daily.flattenMinute).toBeNull();
    expect(trendWarmupDays(daily)).toBe(60);
    expect(trendWarmupDays({ ...daily, breakoutBars: 250 })).toBe(250);
    const { tradeMinutes: _, ...legacy } = DEFAULT_TREND_CONFIG;
    expect(normalizeTrendConfig(legacy as typeof DEFAULT_TREND_CONFIG)).toEqual(
      DEFAULT_TREND_CONFIG,
    );
  });
});
