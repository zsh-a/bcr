import type { MarketHistoryProvider, MarketHistorySeries, MarketInstrument } from "./model";

const CACHE_PREFIX = "bcr.market-atlas.trend.v1";
const FRESH_MS = 60 * 60_000;
const RETRY_MS = 5 * 60_000;
const MAX_POINTS = 20;

export interface MarketPriceTrend {
  readonly instrumentId: string;
  readonly points: ReadonlyArray<{ readonly date: string; readonly close: number }>;
  readonly receivedAt: number;
  readonly quality: "delayed" | "cached";
  readonly source: string;
}

interface CachedTrend {
  readonly storedAt: number;
  readonly trend: MarketPriceTrend;
}

type TrendStorage = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): TrendStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function isTrend(value: unknown, instrumentId: string): value is MarketPriceTrend {
  if (typeof value !== "object" || value === null) return false;
  const trend = value as MarketPriceTrend;
  return (
    trend.instrumentId === instrumentId &&
    (trend.quality === "delayed" || trend.quality === "cached") &&
    Number.isFinite(trend.receivedAt) &&
    typeof trend.source === "string" &&
    Array.isArray(trend.points) &&
    trend.points.length >= 3 &&
    trend.points.length <= MAX_POINTS &&
    trend.points.every(
      (point, index) =>
        point !== null &&
        typeof point === "object" &&
        /^\d{4}-\d{2}-\d{2}$/u.test(point.date) &&
        Number.isFinite(point.close) &&
        point.close > 0 &&
        (index === 0 || point.date > trend.points[index - 1]!.date),
    )
  );
}

function priceTrend(series: MarketHistorySeries, instrumentId: string): MarketPriceTrend {
  if (series.quality === "demo" || series.instrument.id !== instrumentId) {
    throw new Error("No real price history available");
  }
  const points = new Map<string, { date: string; close: number }>();
  for (const bar of series.bars) {
    if (/^\d{4}-\d{2}-\d{2}$/u.test(bar.date) && Number.isFinite(bar.close) && bar.close > 0) {
      points.set(bar.date, { date: bar.date, close: bar.close });
    }
  }
  const trend: MarketPriceTrend = {
    instrumentId,
    points: [...points.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-MAX_POINTS),
    receivedAt: series.receivedAt,
    quality: series.quality,
    source: series.source,
  };
  if (!isTrend(trend, instrumentId)) throw new Error("Insufficient daily price history");
  return trend;
}

/** Small real daily series, cached independently of the 60-second quote feed. Never synthesizes prices. */
export class MarketTrendService {
  private readonly cache = new Map<string, CachedTrend>();
  private readonly retryAt = new Map<string, number>();

  constructor(
    private readonly provider: MarketHistoryProvider,
    private readonly storage: TrendStorage | null = browserStorage(),
    private readonly now: () => number = Date.now,
  ) {}

  private key(instrumentId: string): string {
    return `${CACHE_PREFIX}:${this.provider.id}:${instrumentId}`;
  }

  private read(instrumentId: string): CachedTrend | null {
    const memory = this.cache.get(instrumentId);
    if (memory) return memory;
    try {
      const raw = this.storage?.getItem(this.key(instrumentId));
      if (!raw || raw.length > 8_192) return null;
      const cached = JSON.parse(raw) as CachedTrend;
      if (!Number.isFinite(cached.storedAt) || !isTrend(cached.trend, instrumentId)) return null;
      this.cache.set(instrumentId, cached);
      return cached;
    } catch {
      return null;
    }
  }

  async load(instrument: MarketInstrument, signal?: AbortSignal): Promise<MarketPriceTrend | null> {
    signal?.throwIfAborted();
    const now = this.now();
    const cached = this.read(instrument.id);
    const age = cached ? now - cached.storedAt : Infinity;
    if ((age >= 0 && age < FRESH_MS) || now < (this.retryAt.get(instrument.id) ?? 0)) {
      return cached ? { ...cached.trend, quality: "cached" } : null;
    }
    try {
      const series = await this.provider.loadHistory({ instrument, range: "1M" }, signal);
      signal?.throwIfAborted();
      const trend = priceTrend(series, instrument.id);
      const next = { storedAt: this.now(), trend };
      this.cache.set(instrument.id, next);
      this.retryAt.delete(instrument.id);
      try {
        this.storage?.setItem(this.key(instrument.id), JSON.stringify(next));
      } catch {
        // The in-memory series remains available if browser storage is full or blocked.
      }
      return trend;
    } catch {
      signal?.throwIfAborted();
      this.retryAt.set(instrument.id, this.now() + RETRY_MS);
      return cached ? { ...cached.trend, quality: "cached" } : null;
    }
  }
}
