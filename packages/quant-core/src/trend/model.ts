import type {
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
import type { ArtifactRef } from "@bcr/core";
import type { BinanceDataset } from "@bcr/market-data/binance/model";
import type { TrendEvaluation } from "./evaluation";
import type { StructuredPullbackPolicy } from "./structured-policy";

export interface TrendStrategy {
  entry: "breakout" | "pullback" | "kdj" | "price-action" | "structured-pullback";
  filter: "none" | "ema" | "background" | "slow-ema";
  /** Maximum estimated round-trip cost in signal ATR units; zero disables the gate. */
  maxCostAtr: number;
  management: "atr" | "channel" | "staged" | "chandelier";
  /** Complete trading-candle close thresholds in frozen initial R; staged mode only. */
  staged?: { breakEvenR: number; trailingStartR: number };
  /** Fixed mechanism ablations, only present for the price-action entry. */
  priceAction?: { keyLevel: boolean; twoLegs: boolean };
  structuredPullback?: StructuredPullbackPolicy;
  direction: "both" | "long" | "short";
  tradeMinutes: number;
  breakoutBars: number;
  /** Channel management only; omitted means floor(breakoutBars / 2), at least one. */
  channelExitBars?: number;
  /** Breakout entry only; omission preserves entry eligibility on every close. */
  breakoutReentry?: "every-close" | "episode";
  stopAtr: number;
  breakEvenAtr: number;
  trailingAtr: number;
}
export interface TrendExecution {
  initialCapital: number;
  feeBps: number;
  slippageBps: number;
  tickSize: number;
  quantityStep: number;
  minNotional: number;
}
export interface TrendRisk {
  riskPct: number;
  maxExposurePct: number;
  cooldownLosses: number;
  cooldownMinutes: number;
  dailyLossPct: number;
  flattenMinute: number | null;
}
export interface TrendConfig {
  version: 10;
  strategy: TrendStrategy;
  execution: TrendExecution;
  risk: TrendRisk;
}
export type TrendEntryTrigger =
  | {
      kind: "kdj-cross";
      armedAt: number;
      armedK: number;
      previousK: number;
      previousD: number;
      k: number;
      d: number;
      j: number;
      slowEma?: number;
      slowEma3Ago?: number;
    }
  | {
      kind: "price-action";
      setupId: number;
      impulseStartTime: number;
      impulseConfirmedAt: number;
      pullbackStartedAt: number;
      impulseStartPrice: number;
      impulseExtreme: number;
      referenceAtr: number;
      strengthAtr: number;
      efficiency: number;
      pullbackBars: number;
      retracement: number;
      /** Two means at least two legs, not two candles. */
      legCount: 1 | 2;
      keyLevel?: {
        minutes: number;
        price: number;
        pivotTime: number;
        confirmedAt: number;
        retestTime?: number;
        valid: boolean;
      };
    }
  | {
      kind: "structured-pullback";
      setupId: number;
      impulseStartTime: number;
      impulseConfirmedAt: number;
      impulseEndTime: number;
      pullbackStartedAt?: number;
      impulseStartPrice: number;
      impulseExtreme: number;
      referenceAtr: number;
      strengthAtr: number;
      efficiency: number;
      pullbackBars: number;
      retracement: number;
      /** Version 10 evidence; omitted in frozen version 9 snapshots. */
      confirmation?: "before-breakout" | "signal-close";
      keyRole?: "pullback-retest" | "impulse-context";
      gates?: { retracement: boolean; key: boolean; shape: boolean; candle: boolean };
      contextEligible?: { pivot: boolean; ema: boolean };
      /** Non-exclusive causal shape labels; the configured gate selects eligibility. */
      shapes: { twoLegs: boolean; wedge: boolean; channel: boolean; doubleTest: boolean };
      candles: {
        doubleDoji: boolean;
        narrowRange: boolean;
        engulfing: boolean;
        doji: boolean;
        insideBar: boolean;
        outsideBar: boolean;
        reversal: boolean;
      };
      turns: { kind: "high" | "low"; time: number; confirmedAt: number; price: number }[];
      pivot?: {
        minutes: number;
        price: number;
        pivotTime: number;
        confirmedAt: number;
        retestTime?: number;
        valid: boolean;
      };
      ema?: {
        minutes: number;
        period: 20;
        value: number;
        observedAt: number;
        validatedAt: number;
        touches: 2;
        retestTime?: number;
        valid: boolean;
      };
    };
/** Frozen when the completed trading candle triggers an entry, before next-open execution. */
export interface TrendEntrySignal {
  /** Signal candle close timestamp in milliseconds. */
  time: number;
  /** Signal candle close price, without execution costs. */
  price: number;
  /** Previous channel high/low, or the impulse extreme for a pullback. */
  boundary?: number;
  atr: number;
  /** Prior channel candles, excluding the signal candle; absent for pullbacks. */
  lookbackBars?: number;
  trigger?: TrendEntryTrigger;
}
export interface TrendTrade {
  id: number;
  side: "long" | "short";
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  /** Added in executor 8; historical ledgers may omit this snapshot. */
  entrySignal?: TrendEntrySignal;
  exitPrice: number;
  quantity: number;
  initialStop: number;
  risk: number;
  grossPnl: number;
  fees: number;
  funding: number;
  /** Executor 9: modeled slippage and adverse rounding already included in fill prices. */
  slippageAndRounding?: number;
  netPnl: number;
  rMultiple: number;
  mfeR: number;
  maeR: number;
  reason: string;
}
export interface TrendEvent {
  time: number;
  kind:
    | "impulse"
    | "signal"
    | "entry"
    | "stop"
    | "exit"
    | "funding"
    | "cooldown"
    | "rejected"
    | "stage"
    | "setup";
  side: "long" | "short";
  price: number;
  value: number | null;
  tradeId: number | null;
  reason: string;
  /** Signal events in executor 8 retain the same snapshot as the resulting trade. */
  entrySignal?: TrendEntrySignal;
}
export interface TrendEquity {
  time: number;
  equity: number;
  cash: number;
  drawdown: number;
}
export interface TrendIndicator {
  time: number;
  fast?: number;
  slow?: number;
  k?: number;
  d?: number;
  j?: number;
}
/** An as-of decision for an otherwise eligible entry signal, never a future label. */
export interface TrendContextDecision {
  time: number;
  price: number;
  side: "long" | "short";
  minutes: number;
  asOf: number | null;
  phase: "warming" | "range" | "uptrend" | "downtrend" | "conflict";
  direction: "long" | "short" | null;
  reference: number | null;
  anchor: number | null;
  efficiency: number | null;
  extensionAtr: number | null;
  costAtr: number | null;
  allowed: boolean;
  reason: string;
}
export interface TrendContextMetrics {
  evaluated: number;
  allowed: number;
  rejected: number;
  reasons: Record<string, number>;
}
export interface TrendChunk {
  trades: TrendTrade[];
  events: TrendEvent[];
  equity: TrendEquity[];
  indicators: TrendIndicator[];
  contexts?: TrendContextDecision[];
}
export interface TrendMetrics {
  evaluation?: TrendEvaluation;
  finalEquity: number;
  totalReturn: number;
  maxDrawdown: number;
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  profitFactor: number | null;
  meanR: number | null;
  fees: number;
  funding: number;
  longestLossStreak: number;
  rejectedSignals: number;
  fundingEvents: number;
  rows: number;
  context?: TrendContextMetrics;
}
export interface TrendResult {
  version: 1;
  engine:
    | "trend-continuation-1"
    | "trend-continuation-2"
    | "trend-continuation-3"
    | "trend-continuation-4"
    | "trend-continuation-5"
    | "trend-continuation-6"
    | "trend-continuation-7"
    | "trend-continuation-8"
    | "trend-continuation-9"
    | "trend-continuation-10"
    | "trend-continuation-11"
    | "trend-continuation-12"
    | "trend-continuation-13"
    | "trend-continuation-14"
    | "trend-continuation-15"
    | "trend-continuation-16";
  /** Actual replay bounds, which may use less prehistory than the cached manifest. */
  window?: { startTime: number; endTime: number; warmupStart: number };
  metrics: TrendMetrics;
  equity: TrendEquity[];
  trades: TrendTrade[];
  chunks: {
    ref: ArtifactRef;
    from: number;
    to: number;
    trades: number;
    contexts?: number;
    indicators?: number;
    positionEvents?: number;
  }[];
}
export interface TrendRun {
  id: string;
  createdAt: string;
  config:
    | TrendConfig
    | RecordedTrendConfigV2
    | RecordedTrendConfigV3
    | RecordedTrendConfigV4
    | RecordedTrendConfigV5
    | RecordedTrendConfigV6
    | RecordedTrendConfigV7
    | RecordedTrendConfigV8
    | RecordedTrendConfigV9
    | ArchivedTrendConfig;
  dataset: BinanceDataset;
  resultRef: ArtifactRef;
  /** Keep the session index small; full evaluation series live in resultRef. */
  metrics: Omit<TrendMetrics, "evaluation">;
  durationMs: number;
  cached: boolean;
}
export const TREND_REASONS: Record<string, string> = {
  initial: "初始止损",
  breakeven: "成本保本",
  trailing: "移动止盈",
  "channel-exit": "反向通道退出",
  "protection-crossed": "保护线越过收盘",
  "breakeven-armed": "收盘 R 达标 · 保本已启用",
  "trailing-armed": "收盘 R 达标 · 跟踪已启用",
  "daily-close": "UTC 每日平仓",
  "daily-loss": "单日亏损限制",
  "end-range": "区间结束",
  "risk-budget": "风险预算不足",
  "stop-distance": "止损距离过大",
  cooldown: "连续亏损冷却",
  "structure-invalid": "开盘跳空破坏入场结构",
  pullback: "强趋势回调突破",
  breakout: "通道突破",
  kdj: "KDJ 回调交叉",
  "price-action": "价格行为 · 推进极值突破",
  "structured-pullback": "结构化回调 · 整段推进极值突破",
  "sp-pullback-start": "结构化回调开始 · 整段推进极值已冻结",
  "sp-disabled": "结构结束 · 持仓或风控禁止入场",
  "sp-direction-invalid": "结构结束 · 方向失效",
  "sp-expired": "结构结束 · 超过有效根数",
  "sp-structure-invalid": "结构结束 · 推进或回调失效",
  "sp-first-break": "结构首次突破 · 本次机会已消费",
  "sp-retracement-invalid": "首次突破未通过 · 回调根数或深度不符",
  "sp-key-level-missing": "首次突破未通过 · 关键位未满足",
  "sp-shape-missing": "首次突破未通过 · 回调结构未满足",
  "sp-candle-missing": "首次突破未通过 · K 线确认未满足",
  "sp-accepted": "入场结构已通过 · 仍需成交与风控检查",
  "pa-key-level-missing": "形态消费 · 关键位回踩未满足",
  "pa-two-legs-missing": "形态消费 · 两腿回调未满足",
  "pa-expired": "形态结束 · 超过有效根数",
  "pa-structure-invalid": "形态结束 · 结构失效",
  "pa-direction-invalid": "形态结束 · 方向失效",
  "pa-disabled": "形态结束 · 持仓或风控禁止入场",
  "breakout-episode-start": "突破阶段开始 · 首次入场机会",
  "breakout-episode-unavailable": "突破阶段已消费 · 持仓或风控禁止入场",
  "breakout-episode-filter": "突破阶段已消费 · 方向过滤未通过",
  "breakout-episode-reset": "突破阶段重置 · 收盘回到冻结边界",
  "pa-retracement-invalid": "形态消费 · 回调根数或深度不符",
  impulse: "强推进确认",
  funding: "资金费结算",
  "context-ready": "背景允许入场",
  "context-warmup": "背景尚未预热完成",
  "context-range": "较大周期缺少方向推进",
  "context-conflict": "较大周期方向与结构冲突",
  "context-direction": "信号与背景方向相反",
  "context-structure": "信号已破坏背景回调结构",
  "context-cost": "往返成本相对波动过高",
  "entry-cost": "独立成本门槛拒绝入场",
};
export const TREND_PHASES: Record<TrendContextDecision["phase"], string> = {
  warming: "预热中",
  range: "整理",
  uptrend: "上行延续",
  downtrend: "下行延续",
  conflict: "方向冲突",
};
