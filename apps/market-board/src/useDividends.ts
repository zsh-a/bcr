import type { DividendSeries, MarketInstrument } from "@bcr/market-data";
import { useEffect, useRef, useState } from "react";
import { dividendService } from "./marketServices";

export interface DividendResource {
  readonly series: DividendSeries | null;
  readonly loading: boolean;
  readonly error: string | null;
}

export function useDividends(instrument: MarketInstrument | undefined): DividendResource {
  const [series, setSeries] = useState<DividendSeries | null>(null);
  const [loading, setLoading] = useState(instrument !== undefined);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  useEffect(() => {
    const current = ++request.current;
    if (instrument === undefined) {
      setSeries(null);
      setLoading(false);
      setError(null);
      return;
    }
    setSeries(null);
    setLoading(true);
    setError(null);
    void dividendService
      .load(instrument)
      .then((next) => {
        if (request.current === current) setSeries(next);
      })
      .catch((reason: unknown) => {
        if (request.current === current) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      })
      .finally(() => {
        if (request.current === current) setLoading(false);
      });
    return () => {
      request.current += 1;
    };
  }, [instrument?.id]);

  return { series, loading, error };
}
