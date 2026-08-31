export type MarketRegion = "CN" | "HK" | "US" | "GLOBAL";
export type AssetClass = "index" | "equity" | "future";
export type DataQuality = "delayed" | "partial" | "cached" | "demo";
export type FeedState = "online" | "degraded" | "offline";
export type SessionState =
  | "pre_market"
  | "open"
  | "lunch_break"
  | "after_hours"
  | "closed"
  | "planned";
export type HistoryRange = "1M" | "3M" | "6M" | "1Y" | "3Y";

export interface MarketInstrument {
  readonly id: string;
  readonly symbol: string;
  readonly sourceSymbol: string;
  readonly name: string;
  readonly shortName: string;
  readonly market: MarketRegion;
  readonly venue: string;
  readonly currency: string;
  readonly timezone: string;
  readonly assetClass: AssetClass;
}

export interface QuoteSnapshot {
  readonly instrument: MarketInstrument;
  readonly price: number;
  readonly change: number;
  /** SDK 的涨跌幅单位为百分数，例如 1.2 表示 +1.2%。 */
  readonly changePercent: number;
  readonly previousClose: number | null;
  readonly high: number | null;
  readonly low: number | null;
  readonly volume: number | null;
  readonly amount: number | null;
  readonly sourceTimestamp: number | null;
  readonly receivedAt: number;
  readonly quality: Exclude<DataQuality, "partial">;
  readonly source: string;
  readonly sparkline: ReadonlyArray<number>;
}

export interface MarketHistoryBar {
  readonly date: string;
  readonly timestamp: number | null;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
  readonly amount: number | null;
}

export interface MarketHistoryRequest {
  readonly instrument: MarketInstrument;
  readonly range: HistoryRange;
  /** 上游不可用时，让演示序列与当前快照保持同一价格量级。 */
  readonly referencePrice?: number | undefined;
}

export interface MarketHistorySeries {
  readonly instrument: MarketInstrument;
  readonly range: HistoryRange;
  readonly bars: ReadonlyArray<MarketHistoryBar>;
  readonly receivedAt: number;
  readonly quality: Exclude<DataQuality, "partial">;
  readonly source: string;
  readonly errors: ReadonlyArray<string>;
}

export interface MarketSession {
  readonly market: MarketRegion | "EU";
  readonly city: string;
  readonly venue: string;
  readonly timezone: string;
  readonly localTime: string;
  readonly state: SessionState;
  readonly coverage: "live" | "planned";
}

export interface ProviderFeed {
  readonly market: MarketRegion;
  readonly state: FeedState;
  readonly itemCount: number;
  readonly message: string;
}

export interface MarketAtlasSnapshot {
  readonly quotes: ReadonlyArray<QuoteSnapshot>;
  readonly futures: ReadonlyArray<QuoteSnapshot>;
  readonly sessions: ReadonlyArray<MarketSession>;
  readonly feeds: ReadonlyArray<ProviderFeed>;
  readonly receivedAt: number;
  readonly quality: DataQuality;
  readonly provider: string;
  readonly errors: ReadonlyArray<string>;
}

export interface MarketDataProvider {
  readonly id: string;
  loadSnapshot(): Promise<MarketAtlasSnapshot>;
}

export interface MarketHistoryProvider {
  readonly id: string;
  loadHistory(request: MarketHistoryRequest): Promise<MarketHistorySeries>;
}

export interface QuantMarketHandoff {
  readonly version: 1;
  readonly createdAt: number;
  readonly instrument: MarketInstrument;
  readonly range: HistoryRange;
  readonly bars: ReadonlyArray<MarketHistoryBar>;
  readonly source: string;
}
