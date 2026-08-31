import { PULSE_INSTRUMENTS } from "./instruments";
import type { MarketAtlasSnapshot, MarketInstrument, MarketSession, QuoteSnapshot } from "./model";
import { quoteSparkline } from "./sparkline";

const DEMO_QUOTES = [
  [3_472.15, 0.62],
  [4_183.81, 0.21],
  [2_891.44, -0.74],
  [1_299.52, 0.16],
  [41.34, 0.83],
  [25_077.48, 1.18],
  [5_644.2, 1.84],
  [612.5, 0.49],
  [154.7, 1.31],
  [54.9, -0.72],
  [45_544.88, -0.19],
  [6_487.32, 0.34],
  [21_455.55, 0.76],
  [313.49, -1.94],
  [178.42, 1.12],
] as const;

function quote(
  instrument: MarketInstrument,
  price: number,
  changePercent: number,
  receivedAt: number,
): QuoteSnapshot {
  const previousClose = price / (1 + changePercent / 100);
  return {
    instrument,
    price,
    change: price - previousClose,
    changePercent,
    previousClose,
    high: price * 1.006,
    low: price * 0.991,
    volume: null,
    amount: null,
    sourceTimestamp: null,
    receivedAt,
    quality: "demo",
    source: "BCR deterministic fixture",
    sparkline: quoteSparkline(instrument.id, price, changePercent),
  };
}

function timeIn(timezone: string, now: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
}

export function fallbackSessions(now = Date.now()): ReadonlyArray<MarketSession> {
  return [
    {
      market: "CN",
      city: "SHANGHAI",
      venue: "SSE / SZSE",
      timezone: "Asia/Shanghai",
      localTime: timeIn("Asia/Shanghai", now),
      state: "closed",
      coverage: "live",
    },
    {
      market: "HK",
      city: "HONG KONG",
      venue: "HKEX",
      timezone: "Asia/Hong_Kong",
      localTime: timeIn("Asia/Hong_Kong", now),
      state: "closed",
      coverage: "live",
    },
    {
      market: "EU",
      city: "LONDON",
      venue: "LSE · NEXT PROVIDER",
      timezone: "Europe/London",
      localTime: timeIn("Europe/London", now),
      state: "planned",
      coverage: "planned",
    },
    {
      market: "US",
      city: "NEW YORK",
      venue: "NYSE / NASDAQ",
      timezone: "America/New_York",
      localTime: timeIn("America/New_York", now),
      state: "closed",
      coverage: "live",
    },
  ];
}

export function createDemoSnapshot(errors: ReadonlyArray<string> = []): MarketAtlasSnapshot {
  const receivedAt = Date.now();
  const quotes = PULSE_INSTRUMENTS.flatMap((instrument, index) => {
    const values = DEMO_QUOTES[index];
    return values === undefined ? [] : [quote(instrument, values[0], values[1], receivedAt)];
  });
  const futures = [
    ["WTI", "WTI Crude", 76.42, 1.08],
    ["GC00Y", "COMEX Gold", 3_422.6, -0.36],
    ["CONC", "Brent Crude", 80.18, 0.74],
    ["HG00Y", "COMEX Copper", 5.71, 1.46],
    ["S00Y", "CBOT Soybean", 1_028.5, -0.58],
    ["NID", "LME Nickel", 15_322, 0.29],
  ].map(([symbol, name, price, changePercent]): QuoteSnapshot => {
    const instrument: MarketInstrument = {
      id: `GLOBAL:FUTURE:${String(symbol)}`,
      symbol: String(symbol),
      sourceSymbol: String(symbol),
      name: String(name),
      shortName: String(name).toUpperCase(),
      market: "GLOBAL",
      venue: "GLOBAL FUTURES",
      currency: "—",
      timezone: "UTC",
      assetClass: "future",
    };
    return quote(instrument, Number(price), Number(changePercent), receivedAt);
  });
  return {
    quotes,
    futures,
    sessions: fallbackSessions(receivedAt),
    feeds: ["CN", "HK", "US", "GLOBAL"].map((market) => ({
      market: market as "CN" | "HK" | "US" | "GLOBAL",
      state: "offline" as const,
      itemCount: 0,
      message: market === "GLOBAL" ? "FUTURES FIXTURE PENDING" : "USING LOCAL FIXTURE",
    })),
    receivedAt,
    quality: "demo",
    provider: "BCR fixture",
    errors,
  };
}
