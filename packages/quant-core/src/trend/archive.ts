import {
  strategyLabel,
  filterLabel,
  backgroundMinutes,
  validateTrendConfig,
  TREND_PERIODS,
} from "./config";
import type { TrendConfig, TrendRun } from "./model";

export type RecordedTrendConfigV2 = Omit<TrendConfig, "version" | "strategy"> & {
  version: 2;
  strategy: Omit<TrendConfig["strategy"], "filter"> & { filter: "none" | "ema" };
};

/** Immutable pre-refactor settings, used only to display/export recorded results. */
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
export function trendRunView(run: TrendRun) {
  const config = run.config;
  if ("version" in config)
    return {
      tradeMinutes: config.strategy.tradeMinutes,
      initialCapital: config.execution.initialCapital,
      tickSize: config.execution.tickSize,
      execution: config.execution,
      label: strategyLabel(config.strategy.entry),
      filter: filterLabel(config.strategy),
      backgroundMinutes:
        config.strategy.filter === "background"
          ? backgroundMinutes(config.strategy.tradeMinutes)
          : null,
      ruleVersion: config.version === 3 ? 4 : 3,
      archived: false,
    };
  return {
    tradeMinutes: config.tradeMinutes ?? 1,
    initialCapital: config.initialCapital,
    tickSize: config.tickSize,
    execution: config,
    label: config.entry === "pullback" ? "强趋势回调突破 · 旧版" : "通道突破 · 旧版",
    filter: `EMA ${config.fastEma} / ${config.slowEma} · ${config.trendMinutes} 分钟`,
    backgroundMinutes: null,
    ruleVersion: null,
    archived: true,
  };
}

/** Validate fields needed to read historical records, without executing old rules. */
export function validateRecordedTrendConfig(
  value: unknown,
): asserts value is TrendConfig | RecordedTrendConfigV2 | ArchivedTrendConfig {
  if (!value || typeof value !== "object") throw new Error("运行配置无效");
  if ("version" in value) {
    if (value.version === 2) {
      const c = value as RecordedTrendConfigV2;
      if (!["none", "ema"].includes(c.strategy?.filter)) throw new Error("旧版方向过滤无效");
      validateTrendConfig({ ...c, version: 3 });
    } else validateTrendConfig(value);
    return;
  }
  const c = value as ArchivedTrendConfig;
  if (
    !["breakout", "pullback"].includes(c.entry) ||
    !TREND_PERIODS.includes((c.tradeMinutes ?? 1) as (typeof TREND_PERIODS)[number]) ||
    !TREND_PERIODS.includes(c.trendMinutes as (typeof TREND_PERIODS)[number]) ||
    [c.initialCapital, c.tickSize, c.quantityStep, c.fastEma, c.slowEma].some(
      (n) => !Number.isFinite(n) || n <= 0,
    ) ||
    [c.feeBps, c.slippageBps].some((n) => !Number.isFinite(n) || n < 0)
  )
    throw new Error("旧版运行配置无效");
}

/** Upgrade only the editable draft. Frozen runs are never rewritten. */
export function restoreTrendDraft(value: unknown): TrendConfig {
  validateRecordedTrendConfig(value);
  if (!("version" in value)) throw new Error("旧版扁平参数不能执行");
  return structuredClone({ ...value, version: 3 });
}
