import {
  strategyLabel,
  filterLabel,
  backgroundMinutes,
  validateTrendConfig,
  managementLabel,
  directionLabel,
  costFilterLabel,
  channelExitBars,
} from "./config";
import type { TrendConfig, TrendRun } from "./model";
import { validateHistoricalTrendConfig, type HistoricalTrendConfig } from "./recorded";
export type {
  ArchivedTrendConfig,
  RecordedTrendConfigV2,
  RecordedTrendConfigV3,
  RecordedTrendConfigV4,
  RecordedTrendConfigV5,
  RecordedTrendConfigV6,
  RecordedTrendConfigV7,
  RecordedTrendConfigV8,
  RecordedTrendConfigV9,
} from "./recorded";

const RULE_VERSION: Record<2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10, number> = {
  2: 3,
  3: 4,
  4: 5,
  5: 6,
  6: 7,
  7: 8,
  8: 9,
  9: 10,
  10: 11,
};
/** Display a validated config by its available fields; validity remains version-specific. */
export function trendRunView(run: TrendRun) {
  const config = run.config;
  if ("version" in config)
    return {
      tradeMinutes: config.strategy.tradeMinutes,
      entry: config.strategy.entry,
      slowEma: config.strategy.filter === "slow-ema",
      staged: "management" in config.strategy && config.strategy.management === "staged",
      priceAction: "priceAction" in config.strategy ? config.strategy.priceAction : undefined,
      structuredPullback:
        "structuredPullback" in config.strategy ? config.strategy.structuredPullback : undefined,
      tradeDirection: config.strategy.direction,
      initialCapital: config.execution.initialCapital,
      tickSize: config.execution.tickSize,
      execution: config.execution,
      label:
        strategyLabel(config.strategy.entry, config.strategy.filter) +
        ("breakoutReentry" in config.strategy && config.strategy.breakoutReentry === "episode"
          ? " · 每个突破阶段仅首次机会"
          : ""),
      channelConfig:
        config.strategy.entry === "breakout"
          ? {
              tradeMinutes: config.strategy.tradeMinutes,
              entryBars: config.strategy.breakoutBars,
              exitBars:
                "management" in config.strategy && config.strategy.management === "channel"
                  ? channelExitBars(config.strategy)
                  : null,
            }
          : undefined,
      filter: filterLabel(config.strategy),
      costFilter: costFilterLabel(
        "maxCostAtr" in config.strategy
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
        "management" in config.strategy ? managementLabel(config.strategy) : "保本与 ATR 移动止盈",
      channel: "management" in config.strategy && config.strategy.management === "channel",
      ruleVersion: RULE_VERSION[config.version],
      archived: false,
    };
  return {
    tradeMinutes: config.tradeMinutes ?? 1,
    entry: config.entry,
    slowEma: false,
    staged: false,
    priceAction: undefined,
    structuredPullback: undefined,
    tradeDirection: config.direction ?? "both",
    initialCapital: config.initialCapital,
    tickSize: config.tickSize,
    execution: config,
    label: config.entry === "pullback" ? "强趋势回调突破 · 旧版" : "通道突破 · 旧版",
    channelConfig:
      config.entry === "breakout" &&
      Number.isInteger(config.breakoutBars) &&
      config.breakoutBars >= 2 &&
      config.breakoutBars <= 250
        ? { tradeMinutes: config.tradeMinutes ?? 1, entryBars: config.breakoutBars, exitBars: null }
        : undefined,
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
  if (value && typeof value === "object" && "version" in value && value.version === 10)
    validateTrendConfig(value);
  else validateHistoricalTrendConfig(value);
}

/** Upgrade only the editable draft. Frozen runs are never rewritten. */
export function restoreTrendDraft(value: unknown): TrendConfig {
  validateRecordedTrendConfig(value);
  if (!("version" in value)) throw new Error("旧版扁平参数不能执行");
  const draft = structuredClone({
    ...value,
    version: 10,
    strategy: {
      ...value.strategy,
      ...((value.version === 9 || value.version === 10) &&
      value.strategy.entry === "structured-pullback"
        ? {
            structuredPullback: {
              ...value.strategy.structuredPullback!,
              // Migration semantics are frozen; never borrow current preset defaults here.
              ...(value.version === 9
                ? { confirmation: "before-breakout" as const, keyRole: "pullback-retest" as const }
                : {}),
            },
          }
        : {}),
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
