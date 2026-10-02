/** Bump the engine version when replay behavior changes; executor versions invalidate task caches. */
import { STRATEGIES, strategySpec, type JsgConfig } from "./model";
export const ENGINE_VERSION = "quant-strategies-5";
export const SINGLE_EXECUTOR_VERSION = "quant-streamed-8";
export const GRID_EXECUTOR_VERSION = "quant-grid-shared-4";
export const METRICS_VERSION = "jsg-daily-metrics-1";
export const EVALUATION_VERSION = "jsg-evaluation-2";
export const METRIC_CONVENTIONS = {
  tradingDaysPerYear: 252,
  annualRiskFreeRate: 0,
  returns: "close-to-close-simple-including-first-day",
  variance: "sample",
  downsideTarget: 0,
  downsideDenominator: "all-trading-sessions",
  sortinoNumerator: "annualized-mean-daily-return",
  undefinedRatios: "null",
  winRate: "positive-pnl-sessions-over-all-sessions",
  profitFactor: "positive-daily-pnl-over-absolute-negative-daily-pnl",
  periods: "compound-from-previous-session-equity",
  excessReturn: "strategy-minus-benchmark-percentage-points",
  benchmarkAlignment: "exact-session-with-previous-session-baseline",
} as const;
export function replayVersions(grid = false, config?: JsgConfig) {
  return {
    engine: ENGINE_VERSION,
    executor: grid ? GRID_EXECUTOR_VERSION : SINGLE_EXECUTOR_VERSION,
    metrics: METRICS_VERSION,
    ...(config ? { strategy: STRATEGIES[strategySpec(config).id].version } : {}),
  };
}
export interface ReplayVersions {
  engine: string;
  executor: string;
  metrics: string;
  strategy?: string;
  validation?: string;
  continuousExecutor?: string;
}
