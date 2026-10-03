import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_TREND_CONFIG,
  TREND_PERIODS,
  backgroundMinutes,
  trendWarmupDays,
  validateTrendConfig,
  type TrendConfig,
} from "../src/trend";

const contract = JSON.parse(
  readFileSync(
    new URL("../../../crates/quant/fixtures/trend-contract.json", import.meta.url),
    "utf8",
  ),
) as {
  defaultConfig: TrendConfig;
  periods: { minutes: number; backgroundMinutes: number }[];
  warmupCases: { strategy: Partial<TrendConfig["strategy"]>; days: number }[];
};

describe("shared Rust / TypeScript / Python trend contract", () => {
  it("keeps the new-study default and period mapping explicit", () => {
    expect(DEFAULT_TREND_CONFIG).toEqual(contract.defaultConfig);
    expect(TREND_PERIODS).toEqual(contract.periods.map((p) => p.minutes));
    for (const p of contract.periods)
      expect(backgroundMinutes(p.minutes)).toBe(p.backgroundMinutes);
  });

  it.each(contract.warmupCases)("uses $days warmup days for $strategy", ({ strategy, days }) => {
    const config = {
      ...contract.defaultConfig,
      strategy: { ...contract.defaultConfig.strategy, ...strategy },
    };
    validateTrendConfig(config);
    expect(trendWarmupDays(config)).toBe(days);
  });
});
