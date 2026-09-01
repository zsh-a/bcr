import type { ArtifactRef } from "@bcr/core";

export interface MarketHandoffSeriesSummary {
  readonly instrumentId: string;
  readonly symbol: string;
  readonly name: string;
  readonly market: string;
  readonly range: string;
  readonly bars: number;
  readonly source: string;
}

export interface MarketHandoffSummary {
  readonly version: 1;
  readonly createdAt: number;
  readonly groupId: string | null;
  readonly groupName: string;
  readonly range: string;
  readonly series: ReadonlyArray<MarketHandoffSeriesSummary>;
}

export interface MarketBar {
  readonly date: string;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

/**
 * A normalized series retained by the portfolio intake layer.  Keeping only
 * the fields needed by the analysis makes the handoff independent from any
 * provider-specific quote metadata (amount, timestamps, or quality flags).
 */
export interface PortfolioSeries {
  readonly instrumentId: string;
  readonly symbol: string;
  readonly name: string;
  readonly market: string;
  readonly bars: ReadonlyArray<MarketBar>;
}

export interface CorrelationMatrix {
  readonly symbols: ReadonlyArray<string>;
  readonly values: ReadonlyArray<ReadonlyArray<number>>;
  readonly observations: number;
  readonly startDate: string;
  readonly endDate: string;
}

export interface PortfolioWeight {
  readonly instrumentId: string;
  readonly symbol: string;
  readonly weight: number;
}

export interface PortfolioEquityPoint {
  readonly date: string;
  readonly equity: number;
  /** 相对历史高点的回撤，范围 [-1, 0]。 */
  readonly drawdown: number;
}

export interface PortfolioMetrics {
  readonly totalReturn: number;
  readonly annualizedReturn: number;
  /** 年化波动率。 */
  readonly volatility: number;
  readonly sharpe: number;
  readonly buyHoldReturn: number;
  readonly maxDrawdown: number;
  readonly finalEquity: number;
  readonly observations: number;
  readonly seriesCount: number;
}

export interface PortfolioBacktestResult {
  readonly equity: ReadonlyArray<PortfolioEquityPoint>;
  readonly metrics: PortfolioMetrics;
  readonly weights: ReadonlyArray<PortfolioWeight>;
}

export interface PortfolioAnalysis {
  readonly version: 1;
  readonly series: ReadonlyArray<PortfolioSeries>;
  readonly correlation: CorrelationMatrix;
  readonly backtest: PortfolioBacktestResult;
}

export interface Dataset {
  readonly name: string;
  /** 年度分区清单 Artifact；Worker Pipeline 实际读取 partitions 中的 Arrow 批次。 */
  readonly ref: ArtifactRef;
  /** DuckDB 生成的 Parquet Artifact，作为紧凑、可导出的列式缓存。 */
  readonly parquetRef: ArtifactRef | null;
  readonly partitions: ReadonlyArray<MarketPartition>;
  readonly bars: ReadonlyArray<MarketBar>;
  readonly columnar: ColumnarMetadata;
}

export interface MarketPartition {
  readonly key: string;
  readonly rowCount: number;
  readonly minDate: string;
  readonly maxDate: string;
  readonly arrowBytes: number;
  readonly parquetBytes: number;
  readonly ref: ArtifactRef;
  readonly parquetRef: ArtifactRef;
}

export interface ColumnarMetadata {
  readonly source: "demo" | "csv" | "parquet" | "legacy-json" | "market-atlas";
  readonly engine: string;
  readonly arrowBytes: number;
  readonly parquetBytes: number;
  readonly partitionCount: number;
  readonly rowCount: number;
  readonly minDate: string;
  readonly maxDate: string;
  readonly averageVolume: number;
}

export interface StrategyConfig {
  readonly fastPeriod: number;
  readonly slowPeriod: number;
  readonly initialCapital: number;
  readonly feeBps: number;
}

export interface SignalPoint {
  readonly date: string;
  readonly fast: number | null;
  readonly slow: number | null;
  readonly position: 0 | 1;
  readonly action: "buy" | "sell" | null;
}

export interface EquityPoint {
  readonly date: string;
  readonly equity: number;
  /** 相对历史高点的回撤，范围 [-1, 0]。 */
  readonly drawdown: number;
}

export interface Trade {
  readonly entryDate: string;
  readonly entryPrice: number;
  readonly exitDate: string | null;
  readonly exitPrice: number | null;
  readonly returnPct: number;
  readonly pnl: number;
}

export interface BacktestMetrics {
  readonly engine: "rust-wasm" | "typescript-reference" | "typescript-fallback";
  readonly totalReturn: number;
  readonly annualizedReturn: number;
  readonly buyHoldReturn: number;
  readonly sharpe: number;
  readonly maxDrawdown: number;
  readonly winRate: number;
  readonly exposure: number;
  readonly tradeCount: number;
  readonly finalEquity: number;
}

export interface BacktestResult {
  readonly equity: ReadonlyArray<EquityPoint>;
  readonly trades: ReadonlyArray<Trade>;
  readonly metrics: BacktestMetrics;
}

export interface QuantOutputRefs {
  readonly signals: ArtifactRef;
  readonly equity: ArtifactRef;
  readonly trades: ArtifactRef;
  readonly metrics: ArtifactRef;
}

export type NodeStatus = "pending" | "running" | "completed" | "failed" | "cached";

export interface NodeRun {
  readonly status: NodeStatus;
  readonly progress: number;
  readonly error?: string | undefined;
}
