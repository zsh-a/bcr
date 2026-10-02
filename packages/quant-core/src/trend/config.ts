import type { TrendConfig } from "./model";

export const TREND_PERIODS = [1, 3, 5, 15, 30, 60, 120, 240, 1440] as const;
/** Fixed, versioned research rules. They are not optimization parameters. */
export const TREND_RULES = {
  atrPeriod: 14,
  fastEma: 20,
  slowEma: 60,
  impulseBars: 3,
  impulseAtr: 1.5,
  minEfficiency: 0.6,
  minPullbackBars: 2,
  maxPullbackBars: 8,
  minRetracement: 0.2,
  maxRetracement: 0.5,
} as const;

export const DEFAULT_TREND_CONFIG: TrendConfig = {
  version: 2,
  strategy: {
    entry: "breakout",
    filter: "none",
    direction: "both",
    tradeMinutes: 1,
    breakoutBars: 20,
    stopAtr: 1.5,
    breakEvenAtr: 1.5,
    trailingAtr: 2,
  },
  execution: {
    initialCapital: 10_000,
    feeBps: 5,
    slippageBps: 2,
    tickSize: 0.1,
    quantityStep: 0.001,
    minNotional: 100,
  },
  risk: {
    riskPct: 0.005,
    maxExposurePct: 0.95,
    cooldownLosses: 3,
    cooldownMinutes: 60,
    dailyLossPct: 0.03,
    // Binance is a 24/7 market; there is no exchange session close.
    flattenMinute: null,
  },
};
export const createTrendConfig = (): TrendConfig => structuredClone(DEFAULT_TREND_CONFIG);
export function periodLabel(minutes: number): string {
  return minutes === 1440 ? "1 天" : minutes >= 60 ? `${minutes / 60} 小时` : `${minutes} 分钟`;
}
export function withTradingPeriod(config: TrendConfig, tradeMinutes: number): TrendConfig {
  return {
    ...config,
    strategy: { ...config.strategy, tradeMinutes },
    risk: {
      ...config.risk,
      flattenMinute: tradeMinutes === 1440 ? null : config.risk.flattenMinute,
    },
  };
}
export function trendWarmupDays({ strategy: s }: TrendConfig): number {
  const entryBars = s.entry === "breakout" ? s.breakoutBars : TREND_RULES.impulseBars;
  const filterBars = s.filter === "ema" ? TREND_RULES.slowEma : 0;
  return Math.max(
    1,
    Math.ceil((Math.max(TREND_RULES.atrPeriod, entryBars, filterBars) * s.tradeMinutes) / 1440),
  );
}
export function strategyLabel(entry: TrendConfig["strategy"]["entry"]): string {
  return entry === "breakout" ? "通道突破基线" : "回调突破 · 固定规则";
}

export function validateTrendConfig(value: unknown): asserts value is TrendConfig {
  const shape = (input: unknown, expected: object, label: string): Record<string, unknown> => {
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new Error(`${label}无效`);
    const keys = Object.keys(expected),
      object = input as Record<string, unknown>;
    if (Object.keys(object).length !== keys.length || keys.some((key) => !(key in object)))
      throw new Error(`${label}不完整或含未知字段`);
    return object;
  };
  const config = shape(value, DEFAULT_TREND_CONFIG, "趋势配置");
  if (config.version !== 2) throw new Error("趋势配置版本无效");
  const s = shape(config.strategy, DEFAULT_TREND_CONFIG.strategy, "策略参数");
  const e = shape(config.execution, DEFAULT_TREND_CONFIG.execution, "成交设置");
  const r = shape(config.risk, DEFAULT_TREND_CONFIG.risk, "风控规则");
  for (const group of [s, e, r])
    for (const [key, field] of Object.entries(group)) {
      if (
        ["entry", "filter", "direction"].includes(key) ||
        (key === "flattenMinute" && field === null)
      )
        continue;
      if (typeof field !== "number" || !Number.isFinite(field))
        throw new Error(`参数 ${key} 必须是有限数值`);
    }
  const c = value as TrendConfig;
  const strategy = c.strategy,
    execution = c.execution,
    risk = c.risk;
  const integer = (n: number, min: number, max: number) =>
    Number.isInteger(n) && n >= min && n <= max;
  if (
    !["breakout", "pullback"].includes(strategy.entry) ||
    !["none", "ema"].includes(strategy.filter) ||
    !["both", "long", "short"].includes(strategy.direction) ||
    !TREND_PERIODS.includes(strategy.tradeMinutes as (typeof TREND_PERIODS)[number]) ||
    !integer(strategy.breakoutBars, 2, 250) ||
    strategy.stopAtr <= 0 ||
    strategy.stopAtr > 20 ||
    strategy.breakEvenAtr < 0 ||
    strategy.breakEvenAtr > 20 ||
    strategy.trailingAtr <= 0 ||
    strategy.trailingAtr > 20 ||
    execution.initialCapital <= 0 ||
    execution.initialCapital > 1e12 ||
    execution.feeBps < 0 ||
    execution.feeBps > 100 ||
    execution.slippageBps < 0 ||
    execution.slippageBps > 100 ||
    execution.tickSize <= 0 ||
    execution.quantityStep <= 0 ||
    execution.minNotional < 0 ||
    risk.riskPct <= 0 ||
    risk.riskPct > 0.05 ||
    risk.maxExposurePct <= 0 ||
    risk.maxExposurePct > 1 ||
    !integer(risk.cooldownLosses, 0, 20) ||
    !integer(risk.cooldownMinutes, 0, 1440) ||
    (risk.cooldownLosses > 0 && risk.cooldownMinutes === 0) ||
    risk.dailyLossPct < 0 ||
    risk.dailyLossPct > 0.5 ||
    (risk.flattenMinute !== null && !integer(risk.flattenMinute, 1, 1439)) ||
    (strategy.tradeMinutes === 1440 && risk.flattenMinute !== null)
  )
    throw new Error(
      "参数超出范围：每笔风险 ≤ 5%，名义敞口 ≤ 100%，周期与止损设置必须有效；日线需关闭每日平仓",
    );
}
