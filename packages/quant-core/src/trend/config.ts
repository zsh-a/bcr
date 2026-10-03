import type { TrendConfig } from "./model";
import {
  DEFAULT_STRUCTURED_PULLBACK_POLICY,
  STRUCTURED_PULLBACK_VALUES,
} from "./structured-policy";

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

/** Fixed hypotheses for the background preset, not fitted optimization fields. */
export const TREND_BACKGROUND_RULES = {
  window: 20,
  emaPeriod: 20,
  slopeBars: 3,
  pivotRadius: 2,
  minEfficiency: 0.3,
} as const;
export const TREND_KDJ_RULES = {
  period: 9,
  kSmoothing: 3,
  dSmoothing: 3,
  initial: 50,
  oversold: 20,
  overbought: 80,
  emaPeriod: 60,
  slopeBars: 3,
} as const;
/** Preregistered price-action hypotheses; these constants are not tuning controls. */
export const TREND_PRICE_ACTION_RULES = {
  impulseBars: 3,
  impulseAtr: 1.5,
  minEfficiency: 0.6,
  maxExtensionBars: 8,
  minPullbackBars: 2,
  maxPullbackBars: 8,
  minRetracement: 0.2,
  maxRetracement: 0.5,
  pivotRadius: 2,
  keyLevelToleranceAtr: 0.25,
} as const;
export function backgroundMinutes(tradeMinutes: number): number {
  const periods: Record<number, number> = {
    1: 5,
    3: 15,
    5: 30,
    15: 60,
    30: 120,
    60: 240,
    120: 720,
    240: 1440,
    1440: 10080,
  };
  const minutes = periods[tradeMinutes];
  if (!minutes) throw new Error("交易周期无效");
  return minutes;
}
export function filterLabel(
  strategy: Pick<TrendConfig["strategy"], "filter" | "tradeMinutes">,
): string {
  return strategy.filter === "background"
    ? `趋势背景 · ${periodLabel(backgroundMinutes(strategy.tradeMinutes))}`
    : strategy.filter === "ema"
      ? `EMA 20 / 60 · ${periodLabel(strategy.tradeMinutes)}`
      : strategy.filter === "slow-ema"
        ? `EMA 60 方向与三根斜率 · ${periodLabel(strategy.tradeMinutes)}`
        : "无过滤基线";
}

export const DEFAULT_TREND_CONFIG: TrendConfig = {
  version: 10,
  strategy: {
    entry: "breakout",
    filter: "background",
    maxCostAtr: 0,
    management: "channel",
    direction: "long",
    tradeMinutes: 240,
    breakoutBars: 20,
    stopAtr: 2,
    breakEvenAtr: 0,
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
/** A mechanical research preset, never presented as a proven profitable rule. */
export function defaultTrendPreset(config: TrendConfig): TrendConfig {
  const copy = structuredClone(config);
  copy.strategy = {
    ...DEFAULT_TREND_CONFIG.strategy,
    maxCostAtr: config.strategy.maxCostAtr,
  };
  return copy;
}
/** The matching unfiltered baseline preserves the same independent cost policy. */
export function simpleChannelConfig(config: TrendConfig): TrendConfig {
  const copy = defaultTrendPreset(config);
  copy.strategy.filter = "none";
  return copy;
}
/** Screenshot-inspired research hypothesis; not an exact reconstruction of its author. */
export function kdjResearchConfig(config: TrendConfig): TrendConfig {
  const copy = defaultTrendPreset(config);
  copy.strategy = {
    ...copy.strategy,
    entry: "kdj",
    filter: "slow-ema",
    management: "staged",
    direction: "both",
    tradeMinutes: 5,
    stopAtr: 2,
    trailingAtr: 3,
    staged: { breakEvenR: 1, trailingStartR: 2 },
  };
  return copy;
}
/** A falsifiable price-action hypothesis; execution, risk and costs stay unchanged. */
export function priceActionResearchConfig(config: TrendConfig): TrendConfig {
  const copy = kdjResearchConfig(config);
  copy.strategy.entry = "price-action";
  copy.strategy.priceAction = { keyLevel: true, twoLegs: true };
  return copy;
}
/** Fixed structural hypothesis; its continuous stop is distinct from UTC-day protection. */
export function structuredPullbackResearchConfig(config: TrendConfig): TrendConfig {
  const copy = defaultTrendPreset(config);
  copy.strategy = {
    ...copy.strategy,
    entry: "structured-pullback",
    filter: "ema",
    management: "chandelier",
    direction: "both",
    tradeMinutes: 30,
    stopAtr: 2,
    breakEvenAtr: 0,
    trailingAtr: 3,
    structuredPullback: { ...DEFAULT_STRUCTURED_PULLBACK_POLICY },
  };
  copy.risk.dailyLossPct = 0;
  return copy;
}
export function withTrendEntry(
  config: TrendConfig,
  entry: TrendConfig["strategy"]["entry"],
): TrendConfig {
  const { priceAction, structuredPullback, breakoutReentry, ...strategy } = config.strategy;
  return {
    ...config,
    strategy: {
      ...strategy,
      entry,
      ...(entry === "breakout" && breakoutReentry !== undefined ? { breakoutReentry } : {}),
      ...(entry === "structured-pullback"
        ? {
            structuredPullback: structuredPullback
              ? { ...structuredPullback }
              : { ...DEFAULT_STRUCTURED_PULLBACK_POLICY },
          }
        : {}),
      ...(entry === "price-action"
        ? { priceAction: priceAction ? { ...priceAction } : { keyLevel: true, twoLegs: true } }
        : {}),
    },
  };
}
/** Keep conditional parameters out of modes that cannot execute them. */
export function withTrendManagement(
  config: TrendConfig,
  management: TrendConfig["strategy"]["management"],
): TrendConfig {
  const { staged, channelExitBars, ...strategy } = config.strategy;
  const next: TrendConfig = {
    ...config,
    strategy: {
      ...strategy,
      management,
      ...(management === "chandelier" ? { breakEvenAtr: 0 } : {}),
      ...(management === "channel" ? { entry: "breakout" as const } : {}),
      ...(management === "channel" && channelExitBars !== undefined ? { channelExitBars } : {}),
      ...(management === "staged"
        ? { staged: staged ? { ...staged } : { breakEvenR: 1, trailingStartR: 2 } }
        : {}),
    },
  };
  return management === "channel" ? withTrendEntry(next, "breakout") : next;
}
export function channelExitBars(
  strategy: Pick<TrendConfig["strategy"], "breakoutBars" | "channelExitBars">,
): number {
  return strategy.channelExitBars ?? Math.max(1, Math.floor(strategy.breakoutBars / 2));
}
export function managementLabel(
  strategy: Pick<TrendConfig["strategy"], "management" | "breakoutBars" | "channelExitBars">,
): string {
  return strategy.management === "channel"
    ? `反向 ${channelExitBars(strategy)} 根通道退出`
    : strategy.management === "staged"
      ? "收盘 R 分段保护 · 动态 ATR 跟踪"
      : strategy.management === "chandelier"
        ? "连续动态 ATR 跟踪 · 无保本门槛"
        : "保本与 ATR 移动止盈";
}
export function directionLabel(direction: TrendConfig["strategy"]["direction"]): string {
  return direction === "long" ? "仅做多" : direction === "short" ? "仅做空" : "双向";
}
export function costFilterLabel(maxCostAtr: number): string {
  return maxCostAtr > 0 ? `往返成本 ≤ ${maxCostAtr} ATR` : "成本门槛关闭";
}
export function periodLabel(minutes: number): string {
  return minutes === 10080
    ? "1 周"
    : minutes === 1440
      ? "1 天"
      : minutes >= 60
        ? `${minutes / 60} 小时`
        : `${minutes} 分钟`;
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
  const entryBars =
    s.entry === "price-action" || s.entry === "structured-pullback"
      ? TREND_RULES.atrPeriod + TREND_PRICE_ACTION_RULES.impulseBars
      : s.entry === "breakout"
        ? s.breakoutBars
        : s.entry === "kdj"
          ? TREND_KDJ_RULES.period
          : TREND_RULES.impulseBars;
  const filterBars =
    s.filter === "ema"
      ? TREND_RULES.slowEma
      : s.filter === "slow-ema"
        ? TREND_KDJ_RULES.emaPeriod + TREND_KDJ_RULES.slopeBars
        : 0;
  // One extra full background period covers an unaligned first candle.
  const contextMinutes =
    s.entry === "structured-pullback"
      ? 42 * backgroundMinutes(s.tradeMinutes)
      : s.filter === "background" || s.entry === "price-action"
        ? (TREND_BACKGROUND_RULES.window + 2) * backgroundMinutes(s.tradeMinutes)
        : 0;
  return Math.max(
    1,
    Math.ceil(
      Math.max(
        Math.max(
          TREND_RULES.atrPeriod,
          entryBars,
          s.management === "channel" ? channelExitBars(s) : 0,
          filterBars,
        ) * s.tradeMinutes,
        contextMinutes,
      ) / 1440,
    ),
  );
}
export function strategyLabel(
  entry: TrendConfig["strategy"]["entry"],
  filter: TrendConfig["strategy"]["filter"] = "none",
): string {
  return entry === "structured-pullback"
    ? "结构化回调研究"
    : entry === "price-action"
      ? "价格行为回调研究"
      : entry === "kdj"
        ? "KDJ 回调研究"
        : entry === "pullback"
          ? "回调突破 · 固定规则"
          : filter === "none"
            ? "通道突破基线"
            : "通道突破";
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
  if (config.version !== 10) throw new Error("趋势配置版本无效");
  const hasStaged = (config.strategy as TrendConfig["strategy"] | null)?.management === "staged";
  const hasPriceAction =
    (config.strategy as TrendConfig["strategy"] | null)?.entry === "price-action";
  const hasStructuredPullback =
    (config.strategy as TrendConfig["strategy"] | null)?.entry === "structured-pullback";
  const s = shape(
    config.strategy,
    {
      ...DEFAULT_TREND_CONFIG.strategy,
      ...(hasStaged ? { staged: {} } : {}),
      ...(hasPriceAction ? { priceAction: {} } : {}),
      ...(hasStructuredPullback ? { structuredPullback: {} } : {}),
      ...((config.strategy as TrendConfig["strategy"] | null)?.management === "channel" &&
      Object.hasOwn(config.strategy ?? {}, "channelExitBars")
        ? { channelExitBars: 0 }
        : {}),
      ...((config.strategy as TrendConfig["strategy"] | null)?.entry === "breakout" &&
      Object.hasOwn(config.strategy ?? {}, "breakoutReentry")
        ? { breakoutReentry: "every-close" }
        : {}),
    },
    "策略参数",
  );
  const e = shape(config.execution, DEFAULT_TREND_CONFIG.execution, "成交设置");
  const r = shape(config.risk, DEFAULT_TREND_CONFIG.risk, "风控规则");
  for (const group of [s, e, r])
    for (const [key, field] of Object.entries(group)) {
      if (
        [
          "entry",
          "filter",
          "direction",
          "management",
          "staged",
          "priceAction",
          "structuredPullback",
          "breakoutReentry",
        ].includes(key) ||
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
  if (hasPriceAction) {
    const priceAction = shape(
      strategy.priceAction,
      { keyLevel: true, twoLegs: true },
      "价格行为机制",
    );
    if (Object.values(priceAction).some((value) => typeof value !== "boolean"))
      throw new Error("价格行为机制必须为布尔开关");
  }
  if (hasStructuredPullback) {
    const structured = shape(
      strategy.structuredPullback,
      STRUCTURED_PULLBACK_VALUES,
      "结构化回调机制",
    );
    for (const [field, options] of Object.entries(STRUCTURED_PULLBACK_VALUES))
      if (!options.some((value) => value === structured[field]))
        throw new Error("结构化回调机制选项无效");
  }
  if (hasStaged) {
    const staged = shape(strategy.staged, { breakEvenR: 1, trailingStartR: 2 }, "分段保护参数");
    if (
      Object.values(staged).some(
        (value) => typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 20,
      )
    )
      throw new Error("分段保护 R 阈值必须为 0–20；保本为 0 时关闭，跟踪为 0 时从收盘不亏开始启动");
  }
  if (
    !["breakout", "pullback", "kdj", "price-action", "structured-pullback"].includes(
      strategy.entry,
    ) ||
    !["none", "ema", "background", "slow-ema"].includes(strategy.filter) ||
    strategy.maxCostAtr < 0 ||
    strategy.maxCostAtr > 20 ||
    !["atr", "channel", "staged", "chandelier"].includes(strategy.management) ||
    (strategy.management === "channel" && strategy.entry !== "breakout") ||
    (strategy.management === "chandelier" && strategy.breakEvenAtr !== 0) ||
    !["both", "long", "short"].includes(strategy.direction) ||
    !TREND_PERIODS.includes(strategy.tradeMinutes as (typeof TREND_PERIODS)[number]) ||
    !integer(strategy.breakoutBars, 2, 1000) ||
    ("channelExitBars" in s && !integer(strategy.channelExitBars!, 1, 1000)) ||
    ("breakoutReentry" in s && !["every-close", "episode"].includes(strategy.breakoutReentry!)) ||
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
  if (trendWarmupDays(c) > 250) throw new Error("当前周期的有效窗口需要超过 250 天预热");
}
