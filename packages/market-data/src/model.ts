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
