import { createDemoDividendSeries } from "./dividend";
import type { DividendSeries, MarketDiscoveryProvider, MarketInstrument } from "./model";

const CACHE_PREFIX = "bcr.market-atlas.dividends.v1";

function cacheKey(instrument: MarketInstrument): string {
  return `${CACHE_PREFIX}:${instrument.id}`;
}

function readCache(instrument: MarketInstrument): DividendSeries | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(cacheKey(instrument));
    if (raw === null) return null;
    const cached = JSON.parse(raw) as DividendSeries;
    return cached.instrument?.id === instrument.id && Array.isArray(cached.events) ? cached : null;
  } catch {
    return null;
  }
}

function writeCache(instrument: MarketInstrument, series: DividendSeries): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(cacheKey(instrument), JSON.stringify(series));
  } catch {
    // Corporate-action data remains usable when browser storage is blocked.
  }
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/**
 * Keeps the Income Ledger usable across transient provider failures.  A real
 * response wins, cached records are second, and the demo fixture is only
 * allowed for the curated instrument with known records.
 */
export class ResilientDividendService {
  constructor(private readonly provider: Pick<MarketDiscoveryProvider, "loadDividends">) {}

  async load(instrument: MarketInstrument): Promise<DividendSeries> {
    try {
      const series = await this.provider.loadDividends(instrument);
      if (series.coverage === "available") {
        writeCache(instrument, series);
        return series;
      }
      const cached = readCache(instrument);
      if (cached !== null && cached.events.length > 0) {
        return {
          ...cached,
          receivedAt: Date.now(),
          source: `${cached.source} · CACHED AFTER EMPTY RESPONSE`,
        };
      }
      return series.coverage === "empty"
        ? createDemoDividendSeries(instrument, "UPSTREAM EMPTY")
        : series;
    } catch (error) {
      const reason = message(error);
      const cached = readCache(instrument);
      if (cached !== null && cached.events.length > 0) {
        return {
          ...cached,
          receivedAt: Date.now(),
          source: `${cached.source} · CACHED AFTER ${reason}`,
        };
      }
      const fallback = createDemoDividendSeries(instrument, `UPSTREAM ${reason}`);
      if (fallback.events.length > 0) return fallback;
      throw error;
    }
  }
}
