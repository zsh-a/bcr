import type { ArtifactRef } from "@bcr/core";
import type { BinanceDataset } from "@bcr/market-data/binance/model";

export interface TrendConfig {
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
  tradeMinutes: number;
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
export interface TrendChunk {
  trades: TrendTrade[];
  events: TrendEvent[];
  equity: TrendEquity[];
  indicators: TrendIndicator[];
}
export interface TrendMetrics {
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
}
export interface TrendResult {
  version: 1;
  engine: "trend-continuation-1" | "trend-continuation-2";
  metrics: TrendMetrics;
  equity: TrendEquity[];
  trades: TrendTrade[];
  chunks: { ref: ArtifactRef; from: number; to: number; trades: number }[];
}
export interface TrendRun {
  id: string;
  createdAt: string;
  config: TrendConfig;
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
  "daily-close": "UTC 每日平仓",
  "daily-loss": "单日亏损限制",
  "end-range": "区间结束",
  "risk-budget": "风险预算不足",
  "stop-distance": "止损距离过大",
  cooldown: "连续亏损冷却",
  "structure-invalid": "开盘跳空破坏回调结构",
  pullback: "强趋势回调突破",
  breakout: "通道突破",
  impulse: "强推进确认",
  funding: "资金费结算",
};
