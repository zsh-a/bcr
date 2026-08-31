import {
  ResilientHistoryService,
  StockSdkProvider,
  type HistoryRange,
  type MarketHistorySeries,
  type QuoteSnapshot,
} from "@bcr/market-data";
import { useCallback, useEffect, useRef, useState } from "react";

const service = new ResilientHistoryService(new StockSdkProvider());

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

  const refresh = useCallback(async () => {
    if (quote === undefined) return;
    const current = ++request.current;
    setLoading(true);
    const next = await service.load({
      instrument: quote.instrument,
      range,
      referencePrice: quote.price,
    });
    if (request.current === current) {
      setSeries(next);
      setLoading(false);
    }
  }, [quote?.instrument.id, quote?.price, range]);

  useEffect(() => {
    setSeries(null);
    void refresh();
    return () => {
      request.current += 1;
    };
  }, [refresh]);

  return { series, loading, refresh };
}
