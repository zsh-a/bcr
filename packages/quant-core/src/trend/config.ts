import type { TrendConfig } from "./model";

export const TREND_PERIODS = [1, 3, 5, 15, 30, 60, 120, 240, 1440] as const;
export function periodLabel(minutes: number): string {
  return minutes === 1440 ? "1 天" : minutes >= 60 ? `${minutes / 60} 小时` : `${minutes} 分钟`;
}
export function withTradingPeriod(config: TrendConfig, tradeMinutes: number): TrendConfig {
  return {
    ...config,
    tradeMinutes,
    trendMinutes: Math.max(tradeMinutes, config.trendMinutes),
    flattenMinute: tradeMinutes === 1440 ? null : config.flattenMinute,
  };
}
export function trendWarmupDays(config: TrendConfig): number {
  return Math.max(
    1,
    Math.ceil(
      Math.max(
        Math.max(config.slowEma, 4) * config.trendMinutes,
        config.atrPeriod * config.tradeMinutes,
        Math.max(config.impulseBars, config.breakoutBars) * config.tradeMinutes,
      ) / 1440,
    ),
  );
}
export function normalizeTrendConfig(config: TrendConfig): TrendConfig {
  const value = { ...config, tradeMinutes: config.tradeMinutes ?? 1 };
  validateTrendConfig(value);
  return value;
}

export const DEFAULT_TREND_CONFIG: TrendConfig = {
  entry: "pullback",
  direction: "both",
  initialCapital: 10_000,
  riskPct: 0.005,
  maxExposurePct: 0.95,
  feeBps: 5,
  slippageBps: 2,
  tickSize: 0.1,
  quantityStep: 0.001,
  minNotional: 100,
  tradeMinutes: 1,
  trendMinutes: 5,
  fastEma: 20,
  slowEma: 60,
  atrPeriod: 14,
  impulseBars: 3,
  impulseAtr: 1.5,
  minEfficiency: 0.6,
  minPullbackBars: 2,
  maxPullbackBars: 8,
  minRetracement: 0.2,
  maxRetracement: 0.5,
  breakoutBars: 20,
  stopAtr: 1.5,
  maxStopAtr: 3,
  breakEvenR: 1,
  trailingStartR: 2,
  trailingAtr: 2,
  cooldownLosses: 3,
  cooldownMinutes: 60,
  dailyLossPct: 0.03,
  flattenMinute: 1437,
};
export function validateTrendConfig(config: TrendConfig): void {
  if (
    !config ||
    !["pullback", "breakout"].includes(config.entry) ||
    !["both", "long", "short"].includes(config.direction)
  )
    throw new Error("趋势策略或方向无效");
  const required = Object.keys(DEFAULT_TREND_CONFIG);
  if (
    Object.keys(config).some((key) => !required.includes(key)) ||
    required.some((key) => !(key in config))
  )
    throw new Error("趋势策略参数不完整或含未知字段");
  for (const [key, value] of Object.entries(config)) {
    if (key === "entry" || key === "direction" || (key === "flattenMinute" && value === null))
      continue;
    if (typeof value !== "number" || !Number.isFinite(value))
      throw new Error(`参数 ${key} 必须是有限数值`);
  }
  const integer = (value: number, min: number, max: number) =>
    Number.isInteger(value) && value >= min && value <= max;
  if (
    config.initialCapital <= 0 ||
    config.initialCapital > 1e12 ||
    config.riskPct <= 0 ||
    config.riskPct > 0.05 ||
    config.maxExposurePct <= 0 ||
    config.maxExposurePct > 1 ||
    config.feeBps < 0 ||
    config.feeBps > 100 ||
    config.slippageBps < 0 ||
    config.slippageBps > 100 ||
    config.tickSize <= 0 ||
    config.quantityStep <= 0 ||
    config.minNotional < 0 ||
    !TREND_PERIODS.includes(config.tradeMinutes as (typeof TREND_PERIODS)[number]) ||
    !TREND_PERIODS.includes(config.trendMinutes as (typeof TREND_PERIODS)[number]) ||
    config.trendMinutes < config.tradeMinutes ||
    !integer(config.fastEma, 2, 200) ||
    !integer(config.slowEma, config.fastEma + 1, 200) ||
    !integer(config.atrPeriod, 2, 100) ||
    !integer(config.impulseBars, 2, 20) ||
    config.impulseAtr <= 0 ||
    config.impulseAtr > 10 ||
    config.minEfficiency < 0 ||
    config.minEfficiency > 1 ||
    !integer(config.minPullbackBars, 1, 60) ||
    !integer(config.maxPullbackBars, config.minPullbackBars, 120) ||
    config.minRetracement < 0 ||
    config.maxRetracement <= config.minRetracement ||
    config.maxRetracement >= 1 ||
    !integer(config.breakoutBars, 2, 250) ||
    config.stopAtr <= 0 ||
    config.maxStopAtr < config.stopAtr ||
    config.maxStopAtr > 20 ||
    config.breakEvenR < 0 ||
    config.trailingStartR <= 0 ||
    config.trailingStartR < config.breakEvenR ||
    config.trailingAtr <= 0 ||
    config.trailingAtr > 20 ||
    !integer(config.cooldownLosses, 0, 20) ||
    !integer(config.cooldownMinutes, 0, 1440) ||
    config.dailyLossPct < 0 ||
    config.dailyLossPct > 0.5 ||
    (config.flattenMinute !== null && !integer(config.flattenMinute, 1, 1439))
  )
    throw new Error(
      "参数超出范围：趋势确认周期不能小于交易周期；风险 ≤ 5%，名义敞口 ≤ 100%，均线、回调与止损区间必须有效",
    );
  if (config.tradeMinutes === 1440 && config.flattenMinute !== null)
    throw new Error("日线交易需要关闭每日平仓，允许跨日持仓");
}
