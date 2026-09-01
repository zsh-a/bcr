import { createDemoMarketLandscape } from "./demo";
import type { MarketLandscapeProvider, MarketLandscapeSnapshot, MarketRankings } from "./model";

const CACHE_KEY = "bcr.market-landscape.snapshot.v1";

function readCache(): MarketLandscapeSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    return raw === null ? null : (JSON.parse(raw) as MarketLandscapeSnapshot);
  } catch {
    return null;
  }
}

function writeCache(snapshot: MarketLandscapeSnapshot): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(snapshot));
  } catch {
    // The landscape remains usable when storage is unavailable.
  }
}

function mergeRankings(
  current: MarketRankings,
  fallback: MarketRankings,
): { rankings: MarketRankings; substituted: boolean } {
  const gainers = current.gainers.length > 0 ? current.gainers : fallback.gainers;
  const decliners = current.decliners.length > 0 ? current.decliners : fallback.decliners;
  const turnover = current.turnover.length > 0 ? current.turnover : fallback.turnover;
  return {
    rankings: { gainers, decliners, turnover },
    substituted:
      gainers !== current.gainers ||
      decliners !== current.decliners ||
      turnover !== current.turnover,
  };
}

export class ResilientMarketLandscapeService {
  constructor(private readonly provider: MarketLandscapeProvider) {}

  async load(): Promise<MarketLandscapeSnapshot> {
    try {
      const current = await this.provider.loadMarketLandscape();
      const demo = createDemoMarketLandscape([], current.receivedAt);
      const cached = readCache();
      const cachedBreadthUsable =
        cached !== null &&
        cached.breadth.total > 0 &&
        (cached.breadth.amount > 0 || cached.breadth.advancing > 0 || cached.breadth.declining > 0);
      const fallbackBreadth = cachedBreadthUsable ? cached.breadth : demo.breadth;
      const fallbackSectors =
        cached !== null && cached.sectors.length > 0 ? cached.sectors : demo.sectors;
      const fallbackRankings =
        cached === null ? demo.rankings : mergeRankings(cached.rankings, demo.rankings).rankings;
      const breadthSubstituted =
        current.breadth.total === 0 ||
        (current.breadth.advancing === 0 && current.breadth.declining === 0);
      const amountSubstituted = !breadthSubstituted && current.breadth.amount === 0;
      const sectorsSubstituted = current.sectors.length === 0;
      const ranked = mergeRankings(current.rankings, fallbackRankings);
      const substituted =
        breadthSubstituted || amountSubstituted || sectorsSubstituted || ranked.substituted;
      const snapshot: MarketLandscapeSnapshot = {
        ...current,
        breadth: breadthSubstituted
          ? fallbackBreadth
          : amountSubstituted
            ? { ...current.breadth, amount: fallbackBreadth.amount }
            : current.breadth,
        rankings: ranked.rankings,
        sectors: sectorsSubstituted ? fallbackSectors : current.sectors,
        quality: substituted ? "partial" : current.quality,
        provider: substituted ? `${current.provider} + resilient fallback` : current.provider,
        errors: substituted
          ? [...current.errors, "LANDSCAPE · one or more discovery layers used fallback data"]
          : current.errors,
      };
      writeCache(snapshot);
      return snapshot;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const cached = readCache();
      if (cached !== null) {
        return {
          ...cached,
          quality: "cached",
          provider: `${cached.provider} · last known snapshot`,
          errors: [message],
        };
      }
      return createDemoMarketLandscape([message]);
    }
  }
}
