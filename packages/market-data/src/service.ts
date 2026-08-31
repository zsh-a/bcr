import { createDemoSnapshot } from "./demo";
import type { MarketAtlasSnapshot, MarketDataProvider, QuoteSnapshot } from "./model";

const CACHE_KEY = "bcr.market-atlas.snapshot.v1";

function cachedQuote(quote: QuoteSnapshot): QuoteSnapshot {
  return { ...quote, quality: "cached" };
}

function readCache(): MarketAtlasSnapshot | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw === null ? null : (JSON.parse(raw) as MarketAtlasSnapshot);
  } catch {
    return null;
  }
}

function writeCache(snapshot: MarketAtlasSnapshot): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(snapshot));
  } catch {
    // Storage is an optimization; live data remains usable when quota/privacy blocks it.
  }
}

export class ResilientMarketService {
  constructor(private readonly provider: MarketDataProvider) {}

  async load(): Promise<MarketAtlasSnapshot> {
    try {
      const snapshot = await this.provider.loadSnapshot();
      writeCache(snapshot);
      return snapshot;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const cached = readCache();
      if (cached !== null) {
        return {
          ...cached,
          quotes: cached.quotes.map(cachedQuote),
          futures: cached.futures.map(cachedQuote),
          quality: "cached",
          errors: [message],
          feeds: cached.feeds.map((feed) => ({
            ...feed,
            state: "degraded",
            message: "SHOWING LAST KNOWN SNAPSHOT",
          })),
        };
      }
      return createDemoSnapshot([message]);
    }
  }
}
