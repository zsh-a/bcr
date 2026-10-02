import type { MarketPriceTrend, QuoteSnapshot } from "@bcr/market-data";
import { useRuntimeActivity } from "@bcr/react";
import { useEffect, useRef, useState } from "react";
import { trendService } from "../data/marketServices";

export interface QuoteTrendResource {
  readonly series: MarketPriceTrend | null;
  readonly loading: boolean;
}

/** Only the visible region loads history; three bounded workers keep quote refresh responsive. */
export function useQuoteTrends(quotes: ReadonlyArray<QuoteSnapshot>, enabled: boolean) {
  const active = useRuntimeActivity();
  const currentQuotes = useRef(quotes);
  currentQuotes.current = quotes;
  const key = quotes.map((q) => `${q.instrument.id}:${q.quality}:${q.receivedAt}`).join("|");
  const [trends, setTrends] = useState<ReadonlyMap<string, QuoteTrendResource>>(new Map());

  useEffect(() => {
    if (!active || !enabled) return;
    const abort = new AbortController();
    const pending = currentQuotes.current.filter((quote) => quote.quality !== "demo");
    setTrends((previous) => {
      const next = new Map<string, QuoteTrendResource>();
      for (const quote of pending) {
        next.set(quote.instrument.id, {
          series: previous.get(quote.instrument.id)?.series ?? null,
          loading: true,
        });
      }
      return next;
    });
    let cursor = 0;
    const load = async () => {
      while (!abort.signal.aborted) {
        const quote = pending[cursor++];
        if (!quote) return;
        try {
          const series = await trendService.load(quote.instrument, abort.signal);
          if (abort.signal.aborted) return;
          setTrends((previous) => {
            const next = new Map(previous);
            next.set(quote.instrument.id, { series, loading: false });
            return next;
          });
        } catch (error) {
          if (!abort.signal.aborted) console.error(error);
        }
      }
    };
    void Promise.all(Array.from({ length: Math.min(3, pending.length) }, load));
    return () => abort.abort();
  }, [active, enabled, key]);

  return trends;
}
