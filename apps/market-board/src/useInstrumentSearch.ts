import { searchKnownInstruments, type MarketSearchResult } from "@bcr/market-data";
import { useEffect, useRef, useState } from "react";
import { marketProvider } from "./marketServices";

export interface InstrumentSearchResource {
  readonly results: ReadonlyArray<MarketSearchResult>;
  readonly loading: boolean;
  readonly error: string | null;
  readonly remoteAvailable: boolean | null;
}

export function useInstrumentSearch(query: string): InstrumentSearchResource {
  const [results, setResults] = useState<ReadonlyArray<MarketSearchResult>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remoteAvailable, setRemoteAvailable] = useState<boolean | null>(null);
  const request = useRef(0);

  useEffect(() => {
    const keyword = query.trim();
    const current = ++request.current;
    if (keyword.length < 2) {
      setResults([]);
      setLoading(false);
      setError(null);
      setRemoteAvailable(null);
      return;
    }
    const local = searchKnownInstruments(keyword);
    setResults(local.slice(0, 12));
    setLoading(true);
    setError(null);
    setRemoteAvailable(null);
    const timer = window.setTimeout(() => {
      void marketProvider
        .searchInstruments(keyword)
        .then((next) => {
          if (request.current === current) {
            const seen = new Set<string>();
            setResults(
              [...next, ...local]
                .filter((item) => {
                  if (seen.has(item.instrument.id)) return false;
                  seen.add(item.instrument.id);
                  return true;
                })
                .slice(0, 12),
            );
            setRemoteAvailable(true);
          }
        })
        .catch((reason: unknown) => {
          if (request.current === current) {
            setResults(local.slice(0, 12));
            setError(reason instanceof Error ? reason.message : String(reason));
            setRemoteAvailable(false);
          }
        })
        .finally(() => {
          if (request.current === current) setLoading(false);
        });
    }, 260);
    return () => window.clearTimeout(timer);
  }, [query]);

  return { results, loading, error, remoteAvailable };
}
