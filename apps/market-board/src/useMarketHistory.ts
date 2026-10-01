import type { HistoryRange, MarketHistorySeries, QuoteSnapshot } from "@bcr/market-data";
import { useCallback, useEffect, useRef, useState } from "react";
import { historyService } from "./marketServices";

export interface MarketHistoryResource {
  readonly series: MarketHistorySeries | null;
  readonly loading: boolean;
  readonly refresh: () => Promise<void>;
}

export function useMarketHistory(
  quote: QuoteSnapshot | undefined,
  range: HistoryRange,
): MarketHistoryResource {
  const [series, setSeries] = useState<MarketHistorySeries | null>(null);
  const [loading, setLoading] = useState(quote !== undefined);
  const request = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const currentQuote = useRef(quote);
  currentQuote.current = quote;

  const refresh = useCallback(async () => {
    const quote = currentQuote.current;
    if (quote === undefined) {
      setLoading(false);
      return;
    }
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const current = ++request.current;
    setLoading(true);
    try {
      const next = await historyService.load(
        { instrument: quote.instrument, range, referencePrice: quote.price },
        abort.signal,
      );
      if (request.current === current && !abort.signal.aborted) setSeries(next);
    } catch (error) {
      if (!abort.signal.aborted) console.error(error);
    } finally {
      if (request.current === current) setLoading(false);
    }
  }, [quote?.instrument.id, range]);

  useEffect(() => {
    setSeries(null);
    void refresh();
    return () => {
      request.current += 1;
      controller.current?.abort();
    };
  }, [refresh]);

  return { series, loading, refresh };
}
