import type {
  MarketInstrument,
  MarketRegion,
  MarketSearchResult,
  QuoteSnapshot,
} from "@bcr/market-data";
import { listKnownInstruments } from "@bcr/market-data";
import { useLocationSearch } from "@bcr/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { marketProvider } from "./marketServices";
import { useInstrumentSearch } from "./useInstrumentSearch";

const INSTRUMENTS_KEY = "bcr.market-atlas.instruments.v1";
const DEFAULT_SELECTED_ID = "CN:SSE:600519";

function initialInstruments(): ReadonlyArray<MarketInstrument> {
  try {
    const saved = localStorage.getItem(INSTRUMENTS_KEY);
    return saved === null ? [] : (JSON.parse(saved) as ReadonlyArray<MarketInstrument>);
  } catch {
    return [];
  }
}

/** Owns global instrument discovery, route selection, and the recent-instrument shelf. */
export function useMarketDiscovery(
  quotes: ReadonlyArray<QuoteSnapshot>,
  futures: ReadonlyArray<QuoteSnapshot>,
) {
  const [selectedId, setSelectedId] = useState(DEFAULT_SELECTED_ID);
  const [region, setRegion] = useState<MarketRegion | "ALL">("ALL");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchCursor, setSearchCursor] = useState(0);
  const [searchingQuote, setSearchingQuote] = useState<string | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [savedInstruments, setSavedInstruments] =
    useState<ReadonlyArray<MarketInstrument>>(initialInstruments);
  const [customQuotes, setCustomQuotes] = useState<ReadonlyArray<QuoteSnapshot>>([]);
  const routeInstrumentId = new URLSearchParams(useLocationSearch()).get("instrument");
  const appliedRouteRef = useRef("");
  const searchRef = useRef<HTMLInputElement>(null);
  const search = useInstrumentSearch(query);
  const allQuotes = useMemo(() => {
    const seen = new Set<string>();
    return [...customQuotes, ...quotes, ...futures].filter((quote) => {
      if (seen.has(quote.instrument.id)) return false;
      seen.add(quote.instrument.id);
      return true;
    });
  }, [customQuotes, futures, quotes]);
  const selected = allQuotes.find((quote) => quote.instrument.id === selectedId) ?? quotes[0];

  useEffect(() => {
    if (routeInstrumentId === null || appliedRouteRef.current === routeInstrumentId) return;
    const existing = allQuotes.find((quote) => quote.instrument.id === routeInstrumentId);
    if (existing !== undefined) {
      appliedRouteRef.current = routeInstrumentId;
      setSelectedId(existing.instrument.id);
      setRegion("ALL");
      return;
    }
    const known = listKnownInstruments().find((item) => item.instrument.id === routeInstrumentId);
    if (known === undefined) return;
    appliedRouteRef.current = routeInstrumentId;
    void marketProvider
      .loadQuote(known.instrument)
      .then((quote) => {
        setCustomQuotes((items) => [
          ...items.filter((item) => item.instrument.id !== known.instrument.id),
          quote,
        ]);
        setSelectedId(known.instrument.id);
        setRegion("ALL");
      })
      .catch(() => undefined);
  }, [allQuotes, routeInstrumentId]);

  useEffect(() => {
    try {
      localStorage.setItem(INSTRUMENTS_KEY, JSON.stringify(savedInstruments));
    } catch {
      // Recently opened instruments remain available for this session.
    }
  }, [savedInstruments]);

  useEffect(() => {
    let cancelled = false;
    void Promise.allSettled(
      savedInstruments.map((instrument) => marketProvider.loadQuote(instrument)),
    ).then((results) => {
      if (cancelled) return;
      setCustomQuotes(
        results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : [])),
      );
    });
    return () => {
      cancelled = true;
    };
    // Restore the persisted discovery shelf once; quote refresh is explicit after that.
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key === "/" && target?.tagName !== "INPUT" && target?.tagName !== "TEXTAREA") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const selectSearchResult = async (
    result: MarketSearchResult,
    fallbackQuote?: QuoteSnapshot,
  ): Promise<void> => {
    const existing = allQuotes.find((quote) => quote.instrument.id === result.instrument.id);
    setSearchingQuote(result.instrument.id);
    setQuoteError(null);
    try {
      const quote = await marketProvider.loadQuote(result.instrument).catch((error: unknown) => {
        if (existing !== undefined) return existing;
        if (fallbackQuote !== undefined) return fallbackQuote;
        throw error;
      });
      setCustomQuotes((items) => [
        ...items.filter((item) => item.instrument.id !== result.instrument.id),
        quote,
      ]);
      setSavedInstruments((items) =>
        [...items.filter((item) => item.id !== result.instrument.id), result.instrument].slice(-24),
      );
      setSelectedId(result.instrument.id);
      setRegion("ALL");
      setQuery("");
      setSearchOpen(false);
    } catch (error) {
      setQuoteError(error instanceof Error ? error.message : String(error));
    } finally {
      setSearchingQuote(null);
    }
  };

  return {
    allQuotes,
    selected,
    region,
    query,
    searchOpen,
    searchCursor,
    searchingQuote,
    quoteError,
    searchRef,
    search,
    setSelectedId,
    setRegion,
    setQuery,
    setSearchOpen,
    setSearchCursor,
    setQuoteError,
    selectSearchResult,
  } as const;
}
