import {
  strategyLabel,
  filterLabel,
  backgroundMinutes,
  validateTrendConfig,
  managementLabel,
  directionLabel,
  costFilterLabel,
} from "./config";
import type { TrendConfig, TrendRun } from "./model";
import { validateHistoricalTrendConfig, type HistoricalTrendConfig } from "./recorded";
export type {
  ArchivedTrendConfig,
  RecordedTrendConfigV2,
  RecordedTrendConfigV3,
  RecordedTrendConfigV4,
} from "./recorded";

const RULE_VERSION: Record<2 | 3 | 4 | 5, number> = { 2: 3, 3: 4, 4: 5, 5: 6 };
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
      costFilter: costFilterLabel(
        config.version === 5
          ? config.strategy.maxCostAtr
          : config.strategy.filter === "background"
            ? 0.5
            : 0,
      ),
      direction: directionLabel(config.strategy.direction),
      backgroundMinutes:
        config.strategy.filter === "background"
          ? backgroundMinutes(config.strategy.tradeMinutes)
          : null,
      management:
        config.version === 4 || config.version === 5
          ? managementLabel(config.strategy)
          : "保本与 ATR 移动止盈",
      channel:
        (config.version === 4 || config.version === 5) && config.strategy.management === "channel",
      ruleVersion: RULE_VERSION[config.version],
      archived: false,
    };
  return {
    tradeMinutes: config.tradeMinutes ?? 1,
    initialCapital: config.initialCapital,
    tickSize: config.tickSize,
    execution: config,
    label: config.entry === "pullback" ? "强趋势回调突破 · 旧版" : "通道突破 · 旧版",
    filter: `EMA ${config.fastEma} / ${config.slowEma} · ${config.trendMinutes} 分钟`,
    costFilter: "原始旧版成本规则",
    direction: directionLabel(config.direction ?? "both"),
    backgroundMinutes: null,
    ruleVersion: null,
    management: "原始旧版持仓规则",
    channel: false,
    archived: true,
  };
}

/** Validate fields needed to read historical records, without executing old rules. */
export function validateRecordedTrendConfig(
  value: unknown,
): asserts value is TrendConfig | HistoricalTrendConfig {
  if (value && typeof value === "object" && "version" in value && value.version === 5)
    validateTrendConfig(value);
  else validateHistoricalTrendConfig(value);
}

/** Upgrade only the editable draft. Frozen runs are never rewritten. */
export function restoreTrendDraft(value: unknown): TrendConfig {
  validateRecordedTrendConfig(value);
  if (!("version" in value)) throw new Error("旧版扁平参数不能执行");
  const draft: TrendConfig = structuredClone({
    ...value,
    version: 5,
    strategy: {
      ...value.strategy,
      management: "management" in value.strategy ? value.strategy.management : "atr",
      maxCostAtr:
        "maxCostAtr" in value.strategy
          ? value.strategy.maxCostAtr
          : value.strategy.filter === "background"
            ? 0.5
            : 0,
    },
  });
  validateTrendConfig(draft);
  return draft;
}
