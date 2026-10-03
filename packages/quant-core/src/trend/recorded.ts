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

/** Uses the original version 2–4 limits, independently of the executable schema. */
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
  if (![2, 3, 4].includes(config.version as number)) throw new Error("旧版运行配置版本无效");
  const groups = [
    shape(
      config.strategy,
      config.version === 4 ? [...STRATEGY_FIELDS, "management"] : STRATEGY_FIELDS,
    ),
    shape(config.execution, EXECUTION_FIELDS),
    shape(config.risk, RISK_FIELDS),
  ];
  for (const group of groups)
    for (const [key, field] of Object.entries(group)) {
      if (
        ["entry", "filter", "direction", "management"].includes(key) ||
        (key === "flattenMinute" && field === null)
      )
        continue;
      if (typeof field !== "number" || !Number.isFinite(field))
        throw new Error(`旧版参数 ${key} 必须是有限数值`);
    }
  const c = value as RecordedTrendConfigV2 | RecordedTrendConfigV3 | RecordedTrendConfigV4;
  const { strategy: s, execution: e, risk: r } = c;
  const integer = (n: number, min: number, max: number) =>
    Number.isInteger(n) && n >= min && n <= max;
  if (
    !["breakout", "pullback"].includes(s.entry) ||
    !(c.version === 2 ? ["none", "ema"] : ["none", "ema", "background"]).includes(s.filter) ||
    (c.version === 4 &&
      (!["atr", "channel"].includes(c.strategy.management) ||
        (c.strategy.management === "channel" && s.entry !== "breakout"))) ||
    !["both", "long", "short"].includes(s.direction) ||
    !PERIODS.includes(s.tradeMinutes) ||
    !integer(s.breakoutBars, 2, 250) ||
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
}
