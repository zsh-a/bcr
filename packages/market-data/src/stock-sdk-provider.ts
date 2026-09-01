import {
  StockSDK,
  type AnyHistoryKline,
  type FullQuote,
  type FuturesKline,
  type GlobalFuturesQuote,
  type HKQuote,
  type MarketStatus,
  type SearchResult,
  type SimpleQuote,
  type USQuote,
} from "stock-sdk";
import { fallbackSessions } from "./demo";
import { instrumentsFor } from "./instruments";
import { buildMarketLandscape } from "./landscape";
import type {
  DividendSeries,
  MarketAtlasSnapshot,
  MarketDataProvider,
  MarketDiscoveryProvider,
  MarketHistoryBar,
  MarketHistoryProvider,
  MarketHistoryRequest,
  MarketHistorySeries,
  MarketInstrument,
  MarketLandscapeProvider,
  MarketLandscapeSnapshot,
  MarketRegion,
  MarketSession,
  MarketSearchResult,
  ProviderFeed,
  QuoteSnapshot,
  SessionState,
} from "./model";

type EquityQuote = SimpleQuote | FullQuote | HKQuote | USQuote;

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
const RANGE_DAYS = { "1M": 45, "3M": 110, "6M": 220, "1Y": 420, "3Y": 1_180 } as const;

function compactDate(value: Date): string {
  return value.toISOString().slice(0, 10).replaceAll("-", "");
}

function historyDates(range: MarketHistoryRequest["range"], now: number) {
  const end = new Date(now);
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - RANGE_DAYS[range]);
  return { startDate: compactDate(start), endDate: compactDate(end) };
}

function historyBar(bar: AnyHistoryKline | FuturesKline): MarketHistoryBar | null {
  if (
    bar.open === null ||
    bar.high === null ||
    bar.low === null ||
    bar.close === null ||
    !Number.isFinite(bar.open) ||
    !Number.isFinite(bar.high) ||
    !Number.isFinite(bar.low) ||
    !Number.isFinite(bar.close)
  ) {
    return null;
  }
  return {
    date: bar.date,
    timestamp: "timestamp" in bar ? bar.timestamp : null,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume ?? 0,
    amount: bar.amount,
  };
}

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

function searchAssetClass(result: SearchResult): MarketInstrument["assetClass"] | null {
  const category =
    result.category ??
    (result.type === "ZS"
      ? "index"
      : result.type.includes("ETF") || result.type.includes("LOF")
        ? "fund"
        : result.type.startsWith("GP")
          ? "stock"
          : "other");
  return category === "stock"
    ? "equity"
    : category === "index" || category === "fund"
      ? category
      : null;
}

function searchInstrument(result: SearchResult): MarketInstrument | null {
  const providerMarket = result.market.toLowerCase();
  const market =
    providerMarket === "sh" || providerMarket === "sz"
      ? "CN"
      : providerMarket === "hk"
        ? "HK"
        : providerMarket === "us"
          ? "US"
          : null;
  const assetClass = searchAssetClass(result);
  if (market === null || assetClass === null) return null;

  const withoutMarket = result.code.replace(/^(sh|sz|hk|us)/i, "");
  const [baseCode = withoutMarket, providerVenue = ""] = withoutMarket.split(".");
  const sourceSymbol = market === "US" ? baseCode.toUpperCase() : baseCode;
  const curated = instrumentsFor(market).find(
    (instrument) =>
      instrument.sourceSymbol.toUpperCase().replace(/^(SH|SZ|HK)/, "") ===
      sourceSymbol.toUpperCase(),
  );
  if (curated !== undefined) return curated;

  const venue =
    market === "CN"
      ? providerMarket === "sh"
        ? "Shanghai"
        : "Shenzhen"
      : market === "HK"
        ? "Hong Kong"
        : providerVenue.toLowerCase() === "oq"
          ? "Nasdaq"
          : providerVenue.toLowerCase() === "n"
            ? "NYSE"
            : "United States";
  const venueId =
    market === "CN"
      ? providerMarket === "sh"
        ? "SSE"
        : "SZSE"
      : market === "HK"
        ? "HKEX"
        : venue === "Nasdaq"
          ? "NASDAQ"
          : venue === "NYSE"
            ? "NYSE"
            : "US";
  const displaySymbol =
    market === "CN"
      ? `${sourceSymbol}.${providerMarket.toUpperCase()}`
      : market === "HK"
        ? `${sourceSymbol}.HK`
        : sourceSymbol;
  return {
    id: `${market}:${venueId}:${sourceSymbol}`,
    symbol: displaySymbol,
    sourceSymbol,
    name: result.name,
    shortName: result.name.toUpperCase(),
    market,
    venue,
    currency: market === "CN" ? "CNY" : market === "HK" ? "HKD" : "USD",
    timezone:
      market === "US" ? "America/New_York" : market === "HK" ? "Asia/Hong_Kong" : "Asia/Shanghai",
    assetClass,
  };
}

function quoteForInstrument(
  instrument: MarketInstrument,
  quote: EquityQuote,
  receivedAt: number,
): QuoteSnapshot {
  const previousClose = "prevClose" in quote ? quote.prevClose : quote.price - quote.change;
  return {
    instrument: { ...instrument, name: quote.name || instrument.name },
    price: quote.price,
    change: quote.change,
    changePercent: quote.changePercent,
    previousClose: Number.isFinite(previousClose) ? previousClose : null,
    high: "high" in quote ? quote.high : null,
    low: "low" in quote ? quote.low : null,
    volume: quote.volume,
    amount: quote.amount,
    sourceTimestamp: "timestamp" in quote ? quote.timestamp : null,
    receivedAt,
    quality: "delayed",
    source: String(quote.source),
    sparkline: [previousClose ?? quote.price, quote.price],
  };
}

function equitySnapshot(
  market: "CN" | "HK" | "US",
  quote: EquityQuote,
  index: number,
  receivedAt: number,
): QuoteSnapshot {
  const instrument = marketInstrument(market, quote, index);
  return quoteForInstrument(instrument, quote, receivedAt);
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

export class StockSdkProvider
  implements
    MarketDataProvider,
    MarketHistoryProvider,
    MarketDiscoveryProvider,
    MarketLandscapeProvider
{
  readonly id = "stock-sdk@2.4.2";
  private readonly sdk = new StockSDK({
    timeout: 10_000,
    retry: { maxRetries: 1, baseDelay: 350 },
    providerPolicies: {
      eastmoney: { timeout: 12_000, rateLimit: { requestsPerSecond: 3, maxBurst: 3 } },
      tencent: { timeout: 10_000, rateLimit: { requestsPerSecond: 4, maxBurst: 4 } },
    },
  });

  async searchInstruments(keyword: string): Promise<ReadonlyArray<MarketSearchResult>> {
    if (keyword.trim().length < 2) return [];
    const results = await this.sdk.search(keyword.trim());
    const seen = new Set<string>();
    return results.flatMap((result) => {
      const instrument = searchInstrument(result);
      if (instrument === null || seen.has(instrument.id)) return [];
      seen.add(instrument.id);
      return [{ instrument, providerType: result.type }];
    });
  }

  async loadQuote(instrument: MarketInstrument): Promise<QuoteSnapshot> {
    const receivedAt = Date.now();
    const quotes =
      instrument.market === "CN"
        ? await this.sdk.quotes.cn([instrument.sourceSymbol])
        : instrument.market === "HK"
          ? await this.sdk.quotes.hk([instrument.sourceSymbol])
          : instrument.market === "US"
            ? await this.sdk.quotes.us([instrument.sourceSymbol])
            : [];
    const quote = quotes[0];
    if (quote === undefined)
      throw new Error(`stock-sdk returned no quote for ${instrument.symbol}`);
    return quoteForInstrument(instrument, quote, receivedAt);
  }

  async loadDividends(instrument: MarketInstrument): Promise<DividendSeries> {
    const receivedAt = Date.now();
    if (instrument.market !== "CN" || instrument.assetClass !== "equity") {
      return {
        instrument,
        coverage: "unsupported",
        events: [],
        receivedAt,
        source: "stock-sdk · A-share reference coverage",
      };
    }
    const code = instrument.sourceSymbol.replace(/^(sh|sz)/i, "");
    const events = (await this.sdk.reference.dividendDetail(code)).map((event) => ({
      reportDate: event.reportDate,
      description: event.dividendDesc,
      cashPerTen: event.dividendPretax,
      dividendYield: event.dividendYield,
      recordDate: event.equityRecordDate,
      exDividendDate: event.exDividendDate,
      payDate: event.payDate,
      status: event.assignProgress,
      eps: event.eps,
      netProfitYoy: event.netProfitYoy,
    }));
    return {
      instrument,
      coverage: events.length > 0 ? "available" : "empty",
      events,
      receivedAt,
      source: `${this.id} · eastmoney dividend reference`,
    };
  }

  async loadHistory(request: MarketHistoryRequest): Promise<MarketHistorySeries> {
    const receivedAt = Date.now();
    const options = {
      period: "daily" as const,
      adjust: "qfq" as const,
      ...historyDates(request.range, receivedAt),
    };
    const market = request.instrument.market;
    const raw =
      market === "CN"
        ? await this.sdk.kline.cn(request.instrument.sourceSymbol, options)
        : market === "HK"
          ? await this.sdk.kline.hk(request.instrument.sourceSymbol, options)
          : market === "US"
            ? await this.sdk.kline.us(request.instrument.sourceSymbol, options)
            : await this.sdk.futures.globalKline(request.instrument.sourceSymbol, options);
    const bars = raw.flatMap((bar) => {
      const normalized = historyBar(bar);
      return normalized === null ? [] : [normalized];
    });
    if (bars.length === 0)
      throw new Error(`stock-sdk returned no history for ${request.instrument.symbol}`);
    return {
      instrument: request.instrument,
      range: request.range,
      bars,
      receivedAt,
      quality: "delayed",
      source: `${this.id} · eastmoney daily qfq`,
      errors: [],
    };
  }

  async loadMarketLandscape(): Promise<MarketLandscapeSnapshot> {
    const receivedAt = Date.now();
    const [quotes, boards, sectorFlows] = await Promise.allSettled([
      this.sdk.batch.cn({ batchSize: 500, concurrency: 5 }),
      this.sdk.board.industry.list(),
      this.sdk.fundFlow.sectorRank({ indicator: "today", sectorType: "industry" }),
    ]);
    const settled = [
      ["A-SHARE UNIVERSE", quotes],
      ["INDUSTRY BOARDS", boards],
      ["SECTOR FLOW", sectorFlows],
    ] as const;
    const errors = settled.flatMap(([label, result]) =>
      result.status === "rejected" ? [`${label} · ${errorMessage(result.reason)}`] : [],
    );
    if (settled.every(([, result]) => result.status === "rejected")) {
      throw new Error(errors.join(" / ") || "stock-sdk returned no market landscape");
    }
    const landscape = buildMarketLandscape({
      quotes: quotes.status === "fulfilled" ? quotes.value : [],
      boards: boards.status === "fulfilled" ? boards.value : [],
      sectorFlows: sectorFlows.status === "fulfilled" ? sectorFlows.value : [],
      receivedAt,
      provider: `${this.id} · Tencent + Eastmoney market scan`,
      errors,
    });
    const nextErrors = [...errors];
    if (
      landscape.breadth.total > 0 &&
      landscape.breadth.amount === 0 &&
      landscape.breadth.advancing === 0 &&
      landscape.breadth.declining === 0
    ) {
      nextErrors.push("A-SHARE UNIVERSE · no active-session breadth returned");
    }
    if (landscape.sectors.length === 0) {
      nextErrors.push("INDUSTRY BOARDS · no active-session breadth returned");
    }
    return {
      ...landscape,
      quality: nextErrors.length > 0 ? "partial" : landscape.quality,
      errors: nextErrors,
    };
  }

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
