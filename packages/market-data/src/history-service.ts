import { createDemoHistory } from "./history";
import type { MarketHistoryProvider, MarketHistoryRequest, MarketHistorySeries } from "./model";

const CACHE_PREFIX = "bcr.market-atlas.history.v1";

function cacheKey(request: MarketHistoryRequest): string {
  return `${CACHE_PREFIX}:${request.instrument.id}:${request.range}`;
}

function readCache(request: MarketHistoryRequest): MarketHistorySeries | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(cacheKey(request));
    return raw === null ? null : (JSON.parse(raw) as MarketHistorySeries);
  } catch {
    return null;
  }
}

function writeCache(request: MarketHistoryRequest, series: MarketHistorySeries): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(cacheKey(request), JSON.stringify(series));
  } catch {
    // History cache is opportunistic; the live response remains usable without it.
  }
}

export class ResilientHistoryService {
  constructor(private readonly provider: MarketHistoryProvider) {}

  async load(request: MarketHistoryRequest, signal?: AbortSignal): Promise<MarketHistorySeries> {
    signal?.throwIfAborted();
    try {
      const series = await this.provider.loadHistory(request, signal);
      signal?.throwIfAborted();
      writeCache(request, series);
      return series;
    } catch (error) {
      signal?.throwIfAborted();
      const message = error instanceof Error ? error.message : String(error);
      const cached = readCache(request);
      if (cached !== null) {
        return {
          ...cached,
          quality: "cached",
          errors: [message],
        };
      }
      return createDemoHistory(request, [message]);
    }
  }
}
