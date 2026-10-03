import type {
  ArchivedTrendConfig,
  RecordedTrendConfigV2,
  RecordedTrendConfigV3,
  RecordedTrendConfigV4,
} from "./recorded";
import type { ArtifactRef } from "@bcr/core";
import type { BinanceDataset } from "@bcr/market-data/binance/model";

export interface TrendStrategy {
  entry: "breakout" | "pullback";
  filter: "none" | "ema" | "background";
  /** Maximum estimated round-trip cost in signal ATR units; zero disables the gate. */
  maxCostAtr: number;
  management: "atr" | "channel";
  direction: "both" | "long" | "short";
  tradeMinutes: number;
  breakoutBars: number;
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
  version: 5;
  strategy: TrendStrategy;
  execution: TrendExecution;
  risk: TrendRisk;
}
export interface TrendTrade {
  id: number;
  side: "long" | "short";
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  initialStop: number;
  risk: number;
  grossPnl: number;
  fees: number;
  funding: number;
  netPnl: number;
  rMultiple: number;
  mfeR: number;
  maeR: number;
  reason: string;
}
export interface TrendEvent {
  time: number;
  kind: "impulse" | "signal" | "entry" | "stop" | "exit" | "funding" | "cooldown" | "rejected";
  side: "long" | "short";
  price: number;
  value: number | null;
  tradeId: number | null;
  reason: string;
}
export interface TrendEquity {
  time: number;
  equity: number;
  cash: number;
  drawdown: number;
}
export interface TrendIndicator {
  time: number;
  fast: number;
  slow: number;
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
export interface TrendEvaluation {
  netExpectancy: number | null;
  averageWin: number | null;
  averageLoss: number | null;
  payoffRatio: number | null;
  grossPnl: number;
  meanHoldHours: number | null;
  exposurePct: number;
  turnover: number;
  dailySharpe: number | null;
  sortino: number | null;
  calmar: number | null;
  positiveDays: number;
  totalDays: number;
  bestTradeShare: number | null;
  withoutBestTrade: number;
  longNetPnl: number;
  shortNetPnl: number;
  exitReasons: Record<string, number>;
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
    | "trend-continuation-7";
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
    | ArchivedTrendConfig;
  dataset: BinanceDataset;
  resultRef: ArtifactRef;
  metrics: TrendMetrics;
  durationMs: number;
  cached: boolean;
}
export const TREND_REASONS: Record<string, string> = {
  initial: "初始止损",
  breakeven: "成本保本",
  trailing: "移动止盈",
  "channel-exit": "反向通道退出",
  "daily-close": "UTC 每日平仓",
  "daily-loss": "单日亏损限制",
  "end-range": "区间结束",
  "risk-budget": "风险预算不足",
  "stop-distance": "止损距离过大",
  cooldown: "连续亏损冷却",
  "structure-invalid": "开盘跳空破坏入场结构",
  pullback: "强趋势回调突破",
  breakout: "通道突破",
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
