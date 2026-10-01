/** Bump the engine version when replay behavior changes; executor versions invalidate task caches. */
export const ENGINE_VERSION = "jsg-engine-1";
export const SINGLE_EXECUTOR_VERSION = "jsg-streamed-4";
export const GRID_EXECUTOR_VERSION = "jsg-grid-shared-1";
export const METRICS_VERSION = "jsg-daily-metrics-1";
export const EVALUATION_VERSION = "jsg-evaluation-1";
export const METRIC_CONVENTIONS = {
  tradingDaysPerYear: 252,
  annualRiskFreeRate: 0,
  returns: "close-to-close-simple-including-first-day",
  variance: "sample",
  periods: "compound-from-previous-session-equity",
  excessReturn: "strategy-minus-benchmark-percentage-points",
  benchmarkAlignment: "exact-session-with-previous-session-baseline",
} as const;
export function replayVersions(grid = false) {
  return {
    engine: ENGINE_VERSION,
    executor: grid ? GRID_EXECUTOR_VERSION : SINGLE_EXECUTOR_VERSION,
    metrics: METRICS_VERSION,
  };
}
export type ReplayVersions = ReturnType<typeof replayVersions>;
