import type { ArtifactRef } from "@bcr/core";

export interface MarketBar {
  readonly date: string;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
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
  readonly source: "demo" | "csv" | "parquet" | "legacy-json";
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
