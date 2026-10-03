/** Frozen historical contracts. Do not derive these fields or limits from current defaults. */
interface RecordedStrategyFields {
  entry: "breakout" | "pullback";
  direction: "both" | "long" | "short";
  tradeMinutes: number;
  breakoutBars: number;
  stopAtr: number;
  breakEvenAtr: number;
  trailingAtr: number;
}
interface RecordedStrategyV2 extends RecordedStrategyFields {
  filter: "none" | "ema";
}
interface RecordedStrategyV3 extends RecordedStrategyFields {
  filter: "none" | "ema" | "background";
}
interface RecordedStrategyV4 extends RecordedStrategyV3 {
  management: "atr" | "channel";
}
interface RecordedStrategyV5 extends RecordedStrategyV4 {
  maxCostAtr: number;
}
interface RecordedStrategyV6 {
  entry: "breakout" | "pullback" | "kdj";
  filter: "none" | "ema" | "background" | "slow-ema";
  maxCostAtr: number;
  management: "atr" | "channel" | "staged";
  staged?: { breakEvenR: number; trailingStartR: number };
  direction: "both" | "long" | "short";
  tradeMinutes: number;
  breakoutBars: number;
  stopAtr: number;
  breakEvenAtr: number;
  trailingAtr: number;
}
interface RecordedStrategyV7 {
  entry: "breakout" | "pullback" | "kdj" | "price-action";
  filter: "none" | "ema" | "background" | "slow-ema";
  maxCostAtr: number;
  management: "atr" | "channel" | "staged";
  staged?: { breakEvenR: number; trailingStartR: number };
  priceAction?: { keyLevel: boolean; twoLegs: boolean };
  direction: "both" | "long" | "short";
  tradeMinutes: number;
  breakoutBars: number;
  stopAtr: number;
  breakEvenAtr: number;
  trailingAtr: number;
}
interface RecordedStrategyV8 extends RecordedStrategyV7 {
  channelExitBars?: number;
  breakoutReentry?: "every-close" | "episode";
}
interface RecordedStrategyV9 extends Omit<RecordedStrategyV8, "entry" | "management"> {
  entry: "breakout" | "pullback" | "kdj" | "price-action" | "structured-pullback";
  management: "atr" | "channel" | "staged" | "chandelier";
  structuredPullback?: {
    keyLevel: "none" | "pivot" | "validated-ema" | "either";
    shape: "none" | "any" | "two-legs" | "wedge" | "channel" | "double-test";
    candle: "none" | "reversal";
  };
}
interface RecordedExecution {
  initialCapital: number;
  feeBps: number;
  slippageBps: number;
  tickSize: number;
  quantityStep: number;
  minNotional: number;
}
interface RecordedRisk {
  riskPct: number;
  maxExposurePct: number;
  cooldownLosses: number;
  cooldownMinutes: number;
  dailyLossPct: number;
  flattenMinute: number | null;
}
export interface RecordedTrendConfigV2 {
  version: 2;
  strategy: RecordedStrategyV2;
  execution: RecordedExecution;
  risk: RecordedRisk;
}
export interface RecordedTrendConfigV3 {
  version: 3;
  strategy: RecordedStrategyV3;
  execution: RecordedExecution;
  risk: RecordedRisk;
}
export interface RecordedTrendConfigV4 {
  version: 4;
  strategy: RecordedStrategyV4;
  execution: RecordedExecution;
  risk: RecordedRisk;
}
export interface RecordedTrendConfigV5 {
  version: 5;
  strategy: RecordedStrategyV5;
  execution: RecordedExecution;
  risk: RecordedRisk;
}
export interface RecordedTrendConfigV6 {
  version: 6;
  strategy: RecordedStrategyV6;
  execution: RecordedExecution;
  risk: RecordedRisk;
}
export interface RecordedTrendConfigV7 {
  version: 7;
  strategy: RecordedStrategyV7;
  execution: RecordedExecution;
  risk: RecordedRisk;
}

export interface RecordedTrendConfigV8 {
  version: 8;
  strategy: RecordedStrategyV8;
  execution: RecordedExecution;
  risk: RecordedRisk;
}

export interface RecordedTrendConfigV9 {
  version: 9;
  strategy: RecordedStrategyV9;
  execution: RecordedExecution;
  risk: RecordedRisk;
}

/** Pre-refactor settings are retained for display/export, never current execution. */
export interface ArchivedTrendConfig {
  entry: "pullback" | "breakout";
  direction: "both" | "long" | "short";
  initialCapital: number;
  riskPct: number;
  maxExposurePct: number;
  feeBps: number;
  slippageBps: number;
  tickSize: number;
  quantityStep: number;
  minNotional: number;
  tradeMinutes?: number;
  trendMinutes: number;
  fastEma: number;
  slowEma: number;
  atrPeriod: number;
  impulseBars: number;
  impulseAtr: number;
  minEfficiency: number;
  minPullbackBars: number;
  maxPullbackBars: number;
  minRetracement: number;
  maxRetracement: number;
  breakoutBars: number;
  stopAtr: number;
  maxStopAtr: number;
  breakEvenR: number;
  trailingStartR: number;
  trailingAtr: number;
  cooldownLosses: number;
  cooldownMinutes: number;
  dailyLossPct: number;
  flattenMinute: number | null;
}
export type HistoricalTrendConfig =
  | RecordedTrendConfigV2
  | RecordedTrendConfigV3
  | RecordedTrendConfigV4
  | RecordedTrendConfigV5
  | RecordedTrendConfigV6
  | RecordedTrendConfigV7
  | RecordedTrendConfigV8
  | RecordedTrendConfigV9
  | ArchivedTrendConfig;

const PERIODS = [1, 3, 5, 15, 30, 60, 120, 240, 1440];
const STRATEGY_FIELDS = [
  "entry",
  "filter",
  "direction",
  "tradeMinutes",
  "breakoutBars",
  "stopAtr",
  "breakEvenAtr",
  "trailingAtr",
];
const EXECUTION_FIELDS = [
  "initialCapital",
  "feeBps",
  "slippageBps",
  "tickSize",
  "quantityStep",
  "minNotional",
];
const RISK_FIELDS = [
  "riskPct",
  "maxExposurePct",
  "cooldownLosses",
  "cooldownMinutes",
  "dailyLossPct",
  "flattenMinute",
];
function shape(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("旧版运行配置无效");
  const object = value as Record<string, unknown>;
  if (Object.keys(object).length !== fields.length || fields.some((key) => !(key in object)))
    throw new Error("旧版运行配置不完整或含未知字段");
  return object;
}

/** Uses the original version 2–9 limits, independently of the executable schema. */
export function validateHistoricalTrendConfig(
  value: unknown,
): asserts value is HistoricalTrendConfig {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("旧版运行配置无效");
  if (!("version" in value)) {
    const c = value as ArchivedTrendConfig;
    // Very early flat records only guaranteed the fields required for display.
    if (
      !["breakout", "pullback"].includes(c.entry) ||
      !PERIODS.includes(c.tradeMinutes ?? 1) ||
      !PERIODS.includes(c.trendMinutes) ||
      [c.initialCapital, c.tickSize, c.quantityStep, c.fastEma, c.slowEma].some(
        (n) => !Number.isFinite(n) || n <= 0,
      ) ||
      [c.feeBps, c.slippageBps].some((n) => !Number.isFinite(n) || n < 0)
    )
      throw new Error("旧版运行配置无效");
    return;
  }
  const config = shape(value, ["version", "strategy", "execution", "risk"]);
  if (![2, 3, 4, 5, 6, 7, 8, 9].includes(config.version as number))
    throw new Error("旧版运行配置版本无效");
  const hasStaged =
    (config.version === 6 ||
      config.version === 7 ||
      config.version === 8 ||
      config.version === 9) &&
    (config.strategy as RecordedStrategyV6 | null)?.management === "staged";
  const hasPriceAction =
    (config.version === 7 || config.version === 8 || config.version === 9) &&
    (config.strategy as RecordedStrategyV7 | null)?.entry === "price-action";
  const hasStructuredPullback =
    config.version === 9 &&
    (config.strategy as RecordedStrategyV9 | null)?.entry === "structured-pullback";
  const groups = [
    shape(
      config.strategy,
      config.version === 5 ||
        config.version === 6 ||
        config.version === 7 ||
        config.version === 8 ||
        config.version === 9
        ? [
            ...STRATEGY_FIELDS,
            "management",
            "maxCostAtr",
            ...(hasStaged ? ["staged"] : []),
            ...(hasPriceAction ? ["priceAction"] : []),
            ...(hasStructuredPullback ? ["structuredPullback"] : []),
            ...((config.version === 8 || config.version === 9) &&
            (config.strategy as RecordedStrategyV8 | null)?.management === "channel" &&
            Object.hasOwn(config.strategy ?? {}, "channelExitBars")
              ? ["channelExitBars"]
              : []),
            ...((config.version === 8 || config.version === 9) &&
            (config.strategy as RecordedStrategyV8 | null)?.entry === "breakout" &&
            Object.hasOwn(config.strategy ?? {}, "breakoutReentry")
              ? ["breakoutReentry"]
              : []),
          ]
        : config.version === 4
          ? [...STRATEGY_FIELDS, "management"]
          : STRATEGY_FIELDS,
    ),
    shape(config.execution, EXECUTION_FIELDS),
    shape(config.risk, RISK_FIELDS),
  ];
  for (const group of groups)
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
        throw new Error(`旧版参数 ${key} 必须是有限数值`);
    }
  const c = value as
    | RecordedTrendConfigV2
    | RecordedTrendConfigV3
    | RecordedTrendConfigV4
    | RecordedTrendConfigV5
    | RecordedTrendConfigV6
    | RecordedTrendConfigV7
    | RecordedTrendConfigV8
    | RecordedTrendConfigV9;
  const { strategy: s, execution: e, risk: r } = c;
  const integer = (n: number, min: number, max: number) =>
    Number.isInteger(n) && n >= min && n <= max;
  if ((c.version === 7 || c.version === 8 || c.version === 9) && hasPriceAction) {
    const priceAction = shape(c.strategy.priceAction, ["keyLevel", "twoLegs"]);
    if (Object.values(priceAction).some((field) => typeof field !== "boolean"))
      throw new Error("旧版价格行为机制必须为布尔开关");
  }
  if ((c.version === 6 || c.version === 7 || c.version === 8 || c.version === 9) && hasStaged) {
    const staged = shape(c.strategy.staged, ["breakEvenR", "trailingStartR"]);
    if (
      Object.values(staged).some(
        (n) => typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 20,
      )
    )
      throw new Error("旧版分段保护参数超出原始规则范围");
  }
  if (c.version === 9 && hasStructuredPullback) {
    const structured = shape(c.strategy.structuredPullback, ["keyLevel", "shape", "candle"]);
    if (
      !["none", "pivot", "validated-ema", "either"].includes(structured.keyLevel as string) ||
      !["none", "any", "two-legs", "wedge", "channel", "double-test"].includes(
        structured.shape as string,
      ) ||
      !["none", "reversal"].includes(structured.candle as string)
    )
      throw new Error("旧版结构化回调机制选项无效");
  }
  if (
    !(
      c.version === 9
        ? ["breakout", "pullback", "kdj", "price-action", "structured-pullback"]
        : c.version === 7 || c.version === 8
          ? ["breakout", "pullback", "kdj", "price-action"]
          : c.version === 6
            ? ["breakout", "pullback", "kdj"]
            : ["breakout", "pullback"]
    ).includes(s.entry) ||
    !(
      c.version === 2
        ? ["none", "ema"]
        : c.version === 6 || c.version === 7 || c.version === 8 || c.version === 9
          ? ["none", "ema", "background", "slow-ema"]
          : ["none", "ema", "background"]
    ).includes(s.filter) ||
    ((c.version === 4 ||
      c.version === 5 ||
      c.version === 6 ||
      c.version === 7 ||
      c.version === 8 ||
      c.version === 9) &&
      (!(
        c.version === 9
          ? ["atr", "channel", "staged", "chandelier"]
          : c.version === 6 || c.version === 7 || c.version === 8
            ? ["atr", "channel", "staged"]
            : ["atr", "channel"]
      ).includes(c.strategy.management) ||
        (c.strategy.management === "channel" && s.entry !== "breakout"))) ||
    ((c.version === 5 ||
      c.version === 6 ||
      c.version === 7 ||
      c.version === 8 ||
      c.version === 9) &&
      (c.strategy.maxCostAtr < 0 || c.strategy.maxCostAtr > 20)) ||
    !["both", "long", "short"].includes(s.direction) ||
    !PERIODS.includes(s.tradeMinutes) ||
    !integer(s.breakoutBars, 2, c.version === 8 || c.version === 9 ? 1000 : 250) ||
    ((c.version === 8 || c.version === 9) &&
      "channelExitBars" in s &&
      !integer(c.strategy.channelExitBars!, 1, 1000)) ||
    ((c.version === 8 || c.version === 9) &&
      "breakoutReentry" in s &&
      !["every-close", "episode"].includes(c.strategy.breakoutReentry!)) ||
    (c.version === 9 && c.strategy.management === "chandelier" && s.breakEvenAtr !== 0) ||
    s.stopAtr <= 0 ||
    s.stopAtr > 20 ||
    s.breakEvenAtr < 0 ||
    s.breakEvenAtr > 20 ||
    s.trailingAtr <= 0 ||
    s.trailingAtr > 20 ||
    e.initialCapital <= 0 ||
    e.initialCapital > 1e12 ||
    e.feeBps < 0 ||
    e.feeBps > 100 ||
    e.slippageBps < 0 ||
    e.slippageBps > 100 ||
    e.tickSize <= 0 ||
    e.quantityStep <= 0 ||
    e.minNotional < 0 ||
    r.riskPct <= 0 ||
    r.riskPct > 0.05 ||
    r.maxExposurePct <= 0 ||
    r.maxExposurePct > 1 ||
    !integer(r.cooldownLosses, 0, 20) ||
    !integer(r.cooldownMinutes, 0, 1440) ||
    (r.cooldownLosses > 0 && r.cooldownMinutes === 0) ||
    r.dailyLossPct < 0 ||
    r.dailyLossPct > 0.5 ||
    (r.flattenMinute !== null && !integer(r.flattenMinute, 1, 1439)) ||
    (s.tradeMinutes === 1440 && r.flattenMinute !== null)
  )
    throw new Error("旧版运行参数超出原始规则范围");
  if (c.version === 8 || c.version === 9) {
    const s = c.strategy;
    const background: Record<number, number> = {
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
    const entryBars =
      s.entry === "price-action" || s.entry === "structured-pullback"
        ? 17
        : s.entry === "breakout"
          ? s.breakoutBars
          : s.entry === "kdj"
            ? 9
            : 3;
    const filterBars = s.filter === "ema" ? 60 : s.filter === "slow-ema" ? 63 : 0;
    const exitBars =
      s.management === "channel"
        ? (s.channelExitBars ?? Math.max(1, Math.floor(s.breakoutBars / 2)))
        : 0;
    const contextMinutes =
      s.entry === "structured-pullback"
        ? 42 * background[s.tradeMinutes]!
        : s.filter === "background" || s.entry === "price-action"
          ? 22 * background[s.tradeMinutes]!
          : 0;
    if (
      Math.ceil(
        Math.max(Math.max(14, entryBars, filterBars, exitBars) * s.tradeMinutes, contextMinutes) /
          1440,
      ) > 250
    )
      throw new Error("旧版有效窗口需要超过 250 天预热");
  }
}
