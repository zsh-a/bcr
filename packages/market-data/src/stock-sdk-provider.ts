import {
  StockSDK,
  type GlobalFuturesQuote,
  type HKQuote,
  type MarketStatus,
  type SimpleQuote,
  type USQuote,
} from "stock-sdk";
import { fallbackSessions } from "./demo";
import { instrumentsFor } from "./instruments";
import type {
  MarketAtlasSnapshot,
  MarketDataProvider,
  MarketInstrument,
  MarketRegion,
  MarketSession,
  ProviderFeed,
  QuoteSnapshot,
  SessionState,
} from "./model";

type EquityQuote = SimpleQuote | HKQuote | USQuote;

const MARKET_ORDER = ["CN", "HK", "US", "GLOBAL"] as const;
const FUTURE_PULSE = [
  ["GC00Y", "COMEX GOLD"],
  ["CL00Y", "WTI CRUDE"],
  ["B00Y", "BRENT CRUDE"],
  ["HG00Y", "COMEX COPPER"],
  ["NG00Y", "NATURAL GAS"],
  ["TY00Y", "US 10Y NOTE"],
  ["ES00Y", "S&P 500 FUT"],
  ["NQ00Y", "NASDAQ FUT"],
] as const;

function status(state: MarketStatus): SessionState {
  return state;
}

function liveSessions(sdk: StockSDK, now: number): ReadonlyArray<MarketSession> {
  const fallback = fallbackSessions(now);
  return fallback.map((session) => {
    if (session.market === "EU") return session;
    const sdkMarket = session.market === "CN" ? "A" : session.market;
    if (sdkMarket === "GLOBAL") return session;
    return { ...session, state: status(sdk.calendar.marketStatus(sdkMarket)) };
  });
}

function marketInstrument(
  market: "CN" | "HK" | "US",
  quote: EquityQuote,
  index: number,
): MarketInstrument {
  const instruments = instrumentsFor(market);
  const normalizedCode = quote.code.toUpperCase().replace(/^(SH|SZ|HK)/, "");
  return (
    instruments.find((instrument) =>
      instrument.sourceSymbol
        .toUpperCase()
        .replace(/^(SH|SZ|HK)/, "")
        .endsWith(normalizedCode),
    ) ??
    instruments[index] ?? {
      id: `${market}:UNKNOWN:${normalizedCode}`,
      symbol: normalizedCode,
      sourceSymbol: normalizedCode,
      name: quote.name,
      shortName: quote.name,
      market,
      venue: market,
      currency: market === "CN" ? "CNY" : market === "HK" ? "HKD" : "USD",
      timezone:
        market === "US" ? "America/New_York" : market === "HK" ? "Asia/Hong_Kong" : "Asia/Shanghai",
      assetClass: quote.assetType === "index" ? "index" : "equity",
    }
  );
}

function equitySnapshot(
  market: "CN" | "HK" | "US",
  quote: EquityQuote,
  index: number,
  receivedAt: number,
): QuoteSnapshot {
  const instrument = marketInstrument(market, quote, index);
  const rich = quote as HKQuote | USQuote;
  const previousClose = "prevClose" in quote ? rich.prevClose : quote.price - quote.change;
  return {
    instrument: { ...instrument, name: quote.name || instrument.name },
    price: quote.price,
    change: quote.change,
    changePercent: quote.changePercent,
    previousClose: Number.isFinite(previousClose) ? previousClose : null,
    high: "high" in quote ? rich.high : null,
    low: "low" in quote ? rich.low : null,
    volume: quote.volume,
    amount: quote.amount,
    sourceTimestamp: "timestamp" in quote ? rich.timestamp : null,
    receivedAt,
    quality: "delayed",
    source: String(quote.source),
    sparkline: [previousClose ?? quote.price, quote.price],
  };
}

function futureSnapshot(
  quote: GlobalFuturesQuote,
  shortName: string,
  receivedAt: number,
): QuoteSnapshot | null {
  if (quote.price === null) return null;
  const change = quote.change ?? 0;
  const changePercent = quote.changePercent ?? 0;
  const instrument: MarketInstrument = {
    id: `GLOBAL:FUTURE:${quote.code}`,
    symbol: quote.code,
    sourceSymbol: quote.code,
    name: quote.name,
    shortName,
    market: "GLOBAL",
    venue: "GLOBAL FUTURES",
    currency: "—",
    timezone: "UTC",
    assetClass: "future",
  };
  return {
    instrument,
    price: quote.price,
    change,
    changePercent,
    previousClose: quote.prevSettle,
    high: quote.high,
    low: quote.low,
    volume: quote.volume,
    amount: null,
    sourceTimestamp: null,
    receivedAt,
    quality: "delayed",
    source: "eastmoney",
    sparkline: [quote.prevSettle ?? quote.price - change, quote.price],
  };
}

interface SettledFeed<T> {
  readonly market: MarketRegion;
  readonly result: PromiseSettledResult<T>;
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

export class StockSdkProvider implements MarketDataProvider {
  readonly id = "stock-sdk@2.4.2";
  private readonly sdk = new StockSDK({
    timeout: 10_000,
    retry: { maxRetries: 1, baseDelay: 350 },
    providerPolicies: {
      eastmoney: { timeout: 12_000, rateLimit: { requestsPerSecond: 3, maxBurst: 3 } },
      tencent: { timeout: 10_000, rateLimit: { requestsPerSecond: 4, maxBurst: 4 } },
    },
  });

  async loadSnapshot(): Promise<MarketAtlasSnapshot> {
    const receivedAt = Date.now();
    const [cn, hk, us, futures] = await Promise.allSettled([
      this.sdk.quotes.cnSimple(instrumentsFor("CN").map((item) => item.sourceSymbol)),
      this.sdk.quotes.hk(instrumentsFor("HK").map((item) => item.sourceSymbol)),
      this.sdk.quotes.us(instrumentsFor("US").map((item) => item.sourceSymbol)),
      this.sdk.futures.globalSpot({ pageSize: 20 }),
    ]);
    const settled: ReadonlyArray<SettledFeed<unknown>> = [
      { market: "CN", result: cn },
      { market: "HK", result: hk },
      { market: "US", result: us },
      { market: "GLOBAL", result: futures },
    ];
    const errors = settled.flatMap(({ market, result }) =>
      result.status === "rejected" ? [`${market} · ${errorMessage(result.reason)}`] : [],
    );
    const quoteGroups: ReadonlyArray<ReadonlyArray<QuoteSnapshot>> = [
      cn.status === "fulfilled"
        ? cn.value.map((quote, index) => equitySnapshot("CN", quote, index, receivedAt))
        : [],
      hk.status === "fulfilled"
        ? hk.value.map((quote, index) => equitySnapshot("HK", quote, index, receivedAt))
        : [],
      us.status === "fulfilled"
        ? us.value.map((quote, index) => equitySnapshot("US", quote, index, receivedAt))
        : [],
    ];
    const quotes = quoteGroups.flat();
    const futureQuotes =
      futures.status === "fulfilled"
        ? FUTURE_PULSE.flatMap(([code, shortName]) => {
            const quote = futures.value.find((item) => item.code === code);
            if (quote === undefined) return [];
            const mapped = futureSnapshot(quote, shortName, receivedAt);
            return mapped === null ? [] : [mapped];
          })
        : [];
    if (quotes.length === 0 && futureQuotes.length === 0) {
      throw new Error(errors.join(" / ") || "stock-sdk returned an empty snapshot");
    }
    const feeds: ProviderFeed[] = MARKET_ORDER.map((market, index) => {
      const result = settled[index]?.result;
      const itemCount =
        market === "GLOBAL"
          ? futureQuotes.length
          : quotes.filter((quote) => quote.instrument.market === market).length;
      return {
        market,
        state: result?.status === "fulfilled" && itemCount > 0 ? "online" : "degraded",
        itemCount,
        message:
          result?.status === "fulfilled" && itemCount > 0
            ? "DELAYED FEED ONLINE"
            : result?.status === "rejected"
              ? errorMessage(result.reason)
              : "EMPTY RESPONSE",
      };
    });
    return {
      quotes,
      futures: futureQuotes,
      sessions: liveSessions(this.sdk, receivedAt),
      feeds,
      receivedAt,
      quality: errors.length > 0 ? "partial" : "delayed",
      provider: this.id,
      errors,
    };
  }
}
