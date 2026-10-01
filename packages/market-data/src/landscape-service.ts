import { createDemoMarketLandscape } from "./demo";
import type { MarketLandscapeProvider, MarketLandscapeSnapshot } from "./model";

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

export class ResilientMarketLandscapeService {
  constructor(private readonly provider: MarketLandscapeProvider) {}

  async load(signal?: AbortSignal): Promise<MarketLandscapeSnapshot> {
    signal?.throwIfAborted();
    try {
      const current = await this.provider.loadMarketLandscape(signal);
      signal?.throwIfAborted();
      // Keep each response coherent. Empty live layers stay empty; cached/demo data
      // are only returned as complete, explicitly labelled snapshots on failure.
      const snapshot = current;
      writeCache(snapshot);
      return snapshot;
    } catch (error) {
      signal?.throwIfAborted();
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
