/** Account evaluation emitted by the shared Rust engine, never recomputed from chart previews. */
export const TREND_EVALUATION_CONVENTIONS = {
  calendar: "UTC",
  annualizationDays: 365,
  riskFreeRate: 0,
  downsideTarget: 0,
  minDailyObservations: 30,
  variance: "sample",
  drawdownSampling: "minute-mark-and-fills",
} as const;

interface EvaluationFields {
  netExpectancy: number | null;
  averageWin: number | null;
  averageLoss: number | null;
  payoffRatio: number | null;
  /** PnL after simulated fills, before fees and funding. */
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

/** Historical evaluation retains its original fields and conventions. */
export interface LegacyTrendEvaluation extends EvaluationFields {
  version?: undefined;
}
export interface TrendPeriodPerformance {
  /** Actual covered interval, inclusive start and exclusive end in UTC milliseconds. */
  from: number;
  to: number;
  equity: number;
  returnPct: number | null;
  complete: boolean;
}
export interface TrendDailyPerformance extends TrendPeriodPerformance {
  /** Drawdown against peaks observed in the daily closing equity series. */
  drawdown: number;
  /** Lowest global minute/fill drawdown observed during this day. */
  maxIntradayDrawdown: number;
}
export interface TrendCosts {
  fees: number;
  /** Signed net funding expense; negative values are receipts. */
  funding: number;
  /** Already embedded in fill prices; diagnostic only, never deducted twice. */
  slippageAndRounding: number;
  total: number;
  grossBeforeCosts: number;
  netPnl: number;
  costToGrossProfit: number | null;
}
export interface TrendEvaluationV2 extends EvaluationFields {
  version: 2;
  conventions: typeof TREND_EVALUATION_CONVENTIONS;
  durationMs: number;
  annualizedReturn: number | null;
  annualizedVolatility: number | null;
  dailyMaxDrawdown: number;
  maxDrawdownDurationMs: number;
  currentDrawdownDurationMs: number;
  currentDrawdown: number;
  bestDayReturn: number | null;
  worstDayReturn: number | null;
  daily: TrendDailyPerformance[];
  monthly: TrendPeriodPerformance[];
  costs: TrendCosts;
}
export type TrendEvaluation = LegacyTrendEvaluation | TrendEvaluationV2;
