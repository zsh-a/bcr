import "@fontsource-variable/newsreader/wght.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import type {
  DataQuality,
  DividendSeries,
  HistoryRange,
  MarketInstrument,
  MarketLandscapeSnapshot,
  MarketRankingItem,
  MarketRegion,
  MarketSearchResult,
  MarketSession,
  MarketWatchlistGroup,
  MarketWatchlistState,
  QuoteSnapshot,
  SessionState,
} from "@bcr/market-data";
import { publishQuantHandoff } from "@bcr/market-data";
import {
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Globe2,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Star,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Sparkline } from "./components/Sparkline";
import { CandlestickChart } from "./components/CandlestickChart";
import { historyService, marketProvider } from "./marketServices";
import { useDividends } from "./useDividends";
import { useInstrumentSearch } from "./useInstrumentSearch";
import { useMarketAtlas } from "./useMarketAtlas";
import { useMarketHistory } from "./useMarketHistory";
import { useMarketLandscape } from "./useMarketLandscape";
import "./styles.css";

const WATCHLIST_KEY = "bcr.market-atlas.watchlist.v2";
const LEGACY_WATCHLIST_KEY = "bcr.market-atlas.watchlist.v1";
const INSTRUMENTS_KEY = "bcr.market-atlas.instruments.v1";
const DEFAULT_SELECTED_ID = "CN:SSE:600519";
const DEFAULT_WATCHLIST = ["CN:SSE:000300", "HK:HKEX:HSI", "US:INDEX:INX"];

const DEFAULT_WATCHLIST_GROUPS: ReadonlyArray<MarketWatchlistGroup> = [
  {
    id: "core",
    name: "Core",
    instrumentIds: DEFAULT_WATCHLIST,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "macro",
    name: "Macro",
    instrumentIds: ["CN:SSE:000001", "US:INDEX:DJI", "GLOBAL:FUTURE:GC00Y"],
    createdAt: 0,
    updatedAt: 0,
  },
];
const FALLBACK_WATCHLIST_GROUP = DEFAULT_WATCHLIST_GROUPS[0] as MarketWatchlistGroup;

function signed(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function price(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value >= 10_000 ? 0 : value >= 100 ? 2 : 3,
  }).format(value);
}

function compact(value: number | null): string {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(
    value,
  );
}

function receivedTime(value: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(value);
}

function sessionLabel(state: SessionState): string {
  return {
    pre_market: "PRE-MARKET",
    open: "OPEN",
    lunch_break: "MIDDAY PAUSE",
    after_hours: "AFTER HOURS",
    closed: "CLOSED",
    planned: "NEXT COVERAGE",
  }[state];
}

function qualityLabel(quality: DataQuality): string {
  return {
    delayed: "DELAYED LIVE",
    partial: "PARTIAL LIVE",
    cached: "CACHED SNAPSHOT",
    demo: "DEMO FIXTURE",
  }[quality];
}

function validWatchlistState(value: unknown): value is MarketWatchlistState {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<MarketWatchlistState>;
  return (
    candidate.version === 1 &&
    typeof candidate.activeGroupId === "string" &&
    Array.isArray(candidate.groups) &&
    candidate.groups.length > 0 &&
    candidate.groups.every(
      (group) =>
        typeof group === "object" &&
        group !== null &&
        typeof group.id === "string" &&
        typeof group.name === "string" &&
        Array.isArray(group.instrumentIds),
    )
  );
}

function initialWatchlists(): MarketWatchlistState {
  const now = Date.now();
  try {
    const saved = localStorage.getItem(WATCHLIST_KEY);
    if (saved !== null) {
      const parsed: unknown = JSON.parse(saved);
      if (validWatchlistState(parsed)) {
        const activeGroupId = parsed.groups.some((group) => group.id === parsed.activeGroupId)
          ? parsed.activeGroupId
          : (parsed.groups[0]?.id ?? "core");
        return { ...parsed, activeGroupId };
      }
    }
    const legacy = localStorage.getItem(LEGACY_WATCHLIST_KEY);
    const legacyIds = legacy === null ? null : (JSON.parse(legacy) as unknown);
    const migratedIds =
      Array.isArray(legacyIds) && legacyIds.every((id) => typeof id === "string")
        ? legacyIds
        : DEFAULT_WATCHLIST;
    return {
      version: 1,
      activeGroupId: "core",
      groups: DEFAULT_WATCHLIST_GROUPS.map((group, index) => ({
        ...group,
        instrumentIds: index === 0 ? migratedIds : group.instrumentIds,
        createdAt: now,
        updatedAt: now,
      })),
    };
  } catch {
    return {
      version: 1,
      activeGroupId: "core",
      groups: DEFAULT_WATCHLIST_GROUPS.map((group) => ({
        ...group,
        createdAt: now,
        updatedAt: now,
      })),
    };
  }
}

function initialInstruments(): ReadonlyArray<MarketInstrument> {
  try {
    const saved = localStorage.getItem(INSTRUMENTS_KEY);
    return saved === null ? [] : (JSON.parse(saved) as ReadonlyArray<MarketInstrument>);
  } catch {
    return [];
  }
}

export function App() {
  const { snapshot, refreshing: atlasRefreshing, refresh: refreshAtlas } = useMarketAtlas();
  const {
    snapshot: landscape,
    refreshing: landscapeRefreshing,
    refresh: refreshLandscape,
  } = useMarketLandscape();
  const refreshing = atlasRefreshing || landscapeRefreshing;
  const refresh = async (): Promise<void> => {
    await Promise.all([refreshAtlas(), refreshLandscape()]);
  };
  const [selectedId, setSelectedId] = useState(DEFAULT_SELECTED_ID);
  const [region, setRegion] = useState<MarketRegion | "ALL">("ALL");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchCursor, setSearchCursor] = useState(0);
  const [searchingQuote, setSearchingQuote] = useState<string | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [historyRange, setHistoryRange] = useState<HistoryRange>("1Y");
  const [watchlists, setWatchlists] = useState<MarketWatchlistState>(initialWatchlists);
  const [newGroupName, setNewGroupName] = useState("");
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [handoffLoading, setHandoffLoading] = useState(false);
  const [handoffError, setHandoffError] = useState<string | null>(null);
  const [savedInstruments, setSavedInstruments] =
    useState<ReadonlyArray<MarketInstrument>>(initialInstruments);
  const [customQuotes, setCustomQuotes] = useState<ReadonlyArray<QuoteSnapshot>>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const search = useInstrumentSearch(query);
  const allQuotes = useMemo(() => {
    const seen = new Set<string>();
    return [...customQuotes, ...snapshot.quotes, ...snapshot.futures].filter((quote) => {
      if (seen.has(quote.instrument.id)) return false;
      seen.add(quote.instrument.id);
      return true;
    });
  }, [snapshot, customQuotes]);
  const selected =
    allQuotes.find((quote) => quote.instrument.id === selectedId) ?? snapshot.quotes[0];
  const activeGroup: MarketWatchlistGroup =
    watchlists.groups.find((group) => group.id === watchlists.activeGroupId) ??
    watchlists.groups[0] ??
    FALLBACK_WATCHLIST_GROUP;
  const activeInstrumentIds = activeGroup.instrumentIds;
  const dividends = useDividends(selected?.instrument);
  const history = useMarketHistory(selected, historyRange);
  const historySeries = history.series;
  const currentHistory =
    historySeries !== null &&
    historySeries.instrument.id === selected?.instrument.id &&
    historySeries.range === historyRange
      ? historySeries
      : null;
  const visibleQuotes = snapshot.quotes.filter((quote) => {
    const matchesRegion = region === "ALL" || quote.instrument.market === region;
    const needle = query.trim().toLowerCase();
    const matchesQuery =
      needle.length === 0 ||
      `${quote.instrument.name} ${quote.instrument.symbol} ${quote.instrument.shortName}`
        .toLowerCase()
        .includes(needle);
    return matchesRegion && matchesQuery;
  });
  const movers = [...allQuotes]
    .sort((left, right) => Math.abs(right.changePercent) - Math.abs(left.changePercent))
    .slice(0, 5);
  const watched = activeInstrumentIds.flatMap((id) => {
    const found = allQuotes.find((quote) => quote.instrument.id === id);
    return found === undefined ? [] : [found];
  });
  const advancers = landscape.breadth.advancing;
  const decliners = landscape.breadth.declining;

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

  const openQuant = (): void => {
    if (selected === undefined || currentHistory === null || currentHistory.bars.length < 30)
      return;
    publishQuantHandoff({
      version: 1,
      createdAt: Date.now(),
      instrument: selected.instrument,
      range: historyRange,
      bars: currentHistory.bars,
      source: currentHistory.source,
    });
    window.location.assign("/quant");
  };

  const openWatchlistQuant = async (): Promise<void> => {
    if (handoffLoading || activeGroup === undefined || activeInstrumentIds.length === 0) return;
    const groupQuotes = activeInstrumentIds.flatMap((id) => {
      const quote = allQuotes.find((item) => item.instrument.id === id);
      return quote === undefined ? [] : [quote];
    });
    if (groupQuotes.length === 0) {
      setHandoffError("ACTIVE GROUP HAS NO QUOTEABLE INSTRUMENTS");
      return;
    }
    setHandoffLoading(true);
    setHandoffError(null);
    try {
      const loaded = await Promise.allSettled(
        groupQuotes.map((quote) => {
          if (quote.instrument.id === selected?.instrument.id && currentHistory !== null) {
            return Promise.resolve(currentHistory);
          }
          return historyService.load({
            instrument: quote.instrument,
            range: historyRange,
            referencePrice: quote.price,
          });
        }),
      );
      const series = loaded.flatMap((result) =>
        result.status === "fulfilled" && result.value.bars.length >= 30
          ? [
              {
                instrument: result.value.instrument,
                range: result.value.range,
                bars: result.value.bars,
                source: result.value.source,
              },
            ]
          : [],
      );
      if (series.length === 0) {
        throw new Error("NO GROUP HISTORY SERIES PASSED THE 30-BAR MINIMUM");
      }
      publishQuantHandoff({
        version: 2,
        createdAt: Date.now(),
        groupId: activeGroup.id,
        groupName: activeGroup.name,
        range: historyRange,
        series,
        source: `Market Atlas · ${activeGroup.name}`,
      });
      window.location.assign("/quant");
    } catch (error) {
      setHandoffError(error instanceof Error ? error.message : String(error));
    } finally {
      setHandoffLoading(false);
    }
  };

  useEffect(() => {
    try {
      localStorage.setItem(WATCHLIST_KEY, JSON.stringify(watchlists));
    } catch {
      // Watchlist remains available for this session when persistent storage is blocked.
    }
  }, [watchlists]);

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
      const restored = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      setCustomQuotes(restored);
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

  const toggleWatch = (id: string): void => {
    setWatchlists((state) => {
      const now = Date.now();
      return {
        ...state,
        groups: state.groups.map((group) =>
          group.id !== state.activeGroupId
            ? group
            : {
                ...group,
                instrumentIds: group.instrumentIds.includes(id)
                  ? group.instrumentIds.filter((item) => item !== id)
                  : [...group.instrumentIds, id],
                updatedAt: now,
              },
        ),
      };
    });
  };

  const selectWatchlistGroup = (id: string): void => {
    setWatchlists((state) =>
      state.groups.some((group) => group.id === id) ? { ...state, activeGroupId: id } : state,
    );
  };

  const createWatchlistGroup = (): void => {
    const name = newGroupName.trim();
    if (name.length === 0) return;
    const baseId = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    setWatchlists((state) => {
      const id = `${baseId || "group"}-${Date.now().toString(36)}`;
      const now = Date.now();
      const group: MarketWatchlistGroup = {
        id,
        name,
        instrumentIds: [],
        createdAt: now,
        updatedAt: now,
      };
      return { ...state, activeGroupId: id, groups: [...state.groups, group] };
    });
    setNewGroupName("");
    setCreatingGroup(false);
  };

  return (
    <div className="market-atlas" data-quality={snapshot.quality}>
      <div className="ma-ambient" />
      <header className="ma-header">
        <div className="ma-wordmark">
          <span>MA/01</span>
          <div>
            <small>GLOBAL MARKET INTELLIGENCE</small>
            <b>Market Atlas</b>
          </div>
        </div>
        <div className="ma-search-shell">
          <div className="ma-search">
            <Search className={search.loading ? "spinning" : ""} />
            <input
              ref={searchRef}
              role="combobox"
              aria-label="Search global instruments"
              aria-expanded={searchOpen && query.trim().length >= 2}
              aria-controls="ma-search-results"
              aria-autocomplete="list"
              value={query}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => window.setTimeout(() => setSearchOpen(false), 160)}
              onChange={(event) => {
                setQuery(event.target.value);
                setSearchCursor(0);
                setSearchOpen(true);
                setQuoteError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setSearchOpen(false);
                  event.currentTarget.blur();
                } else if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setSearchCursor((cursor) =>
                    Math.min(Math.max(0, search.results.length - 1), cursor + 1),
                  );
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setSearchCursor((cursor) => Math.max(0, cursor - 1));
                } else if (event.key === "Enter") {
                  const result = search.results[searchCursor];
                  if (result !== undefined) {
                    event.preventDefault();
                    void selectSearchResult(result);
                  }
                }
              }}
              placeholder="Search stocks, indices or ETFs"
            />
            <kbd>/</kbd>
          </div>
          {searchOpen && query.trim().length >= 2 && (
            <div id="ma-search-results" className="ma-search-results" role="listbox">
              <div className="ma-search-summary">
                <span>GLOBAL DISCOVERY</span>
                <small>
                  {search.loading
                    ? search.results.length > 0
                      ? "LOCAL READY · SEARCHING STOCK-SDK"
                      : "SEARCHING STOCK-SDK"
                    : search.remoteAvailable === false
                      ? `${search.results.length} LOCAL MATCHES · REMOTE DEGRADED`
                      : `${search.results.length} QUOTEABLE MATCHES`}
                </small>
              </div>
              {search.results.map((result, index) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={index === searchCursor}
                  key={result.instrument.id}
                  className={index === searchCursor ? "active" : ""}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setSearchCursor(index)}
                  onClick={() => void selectSearchResult(result)}
                  disabled={searchingQuote !== null}
                >
                  <i>{result.instrument.market}</i>
                  <span>
                    <b>{result.instrument.name}</b>
                    <small>
                      {result.instrument.symbol} · {result.instrument.venue}
                    </small>
                  </span>
                  <em>{result.providerType}</em>
                  {searchingQuote === result.instrument.id ? (
                    <RefreshCw className="spinning" />
                  ) : (
                    <ChevronRight />
                  )}
                </button>
              ))}
              {!search.loading && search.results.length === 0 && (
                <div className="ma-search-state">
                  {search.error ?? quoteError ?? "NO QUOTEABLE INSTRUMENTS FOUND"}
                </div>
              )}
              {quoteError !== null && search.results.length > 0 && (
                <div className="ma-search-state error">QUOTE · {quoteError}</div>
              )}
              <footer>CN · HK · US · GLOBAL · STOCKS / INDICES / FUNDS / FUTURES</footer>
            </div>
          )}
        </div>
        <div className="ma-header-actions">
          <div className={`ma-quality ${snapshot.quality}`}>
            <i />
            <span>{qualityLabel(snapshot.quality)}</span>
            <small>{snapshot.provider}</small>
          </div>
          <button
            type="button"
            className="ma-refresh"
            onClick={() => void refresh()}
            disabled={refreshing}
            aria-label="Refresh market data"
          >
            <RefreshCw className={refreshing ? "spinning" : ""} />
            {receivedTime(snapshot.receivedAt)}
          </button>
        </div>
      </header>

      <section className="ma-session-rail" aria-label="Global market sessions">
        {snapshot.sessions.map((session, index) => (
          <Session key={session.city} session={session} index={index + 1} />
        ))}
      </section>

      <main className="ma-content">
        <section className="ma-intro">
          <div>
            <span className="ma-kicker">
              <Globe2 /> THE WORLD, IN MOTION
            </span>
            <h1>
              Markets never move
              <br />
              in isolation.
            </h1>
          </div>
          <p>
            Follow the hand-off from Asia to New York. Delayed public-market data, normalized in the
            browser and kept honest with explicit source health.
          </p>
        </section>

        {selected !== undefined && (
          <section className="ma-hero-grid">
            <article className="ma-focus-card">
              <div className="ma-card-topline">
                <span>
                  {selected.instrument.market} / {selected.instrument.venue}
                </span>
                <button
                  type="button"
                  className={activeInstrumentIds.includes(selected.instrument.id) ? "watched" : ""}
                  onClick={() => toggleWatch(selected.instrument.id)}
                  aria-label={`Toggle ${activeGroup.name} watchlist`}
                >
                  <Star />
                </button>
              </div>
              <div className="ma-focus-body">
                <div className="ma-focus-copy">
                  <span className="ma-symbol">{selected.instrument.symbol}</span>
                  <h2>{selected.instrument.name}</h2>
                  <b>{price(selected.price)}</b>
                  <em className={selected.changePercent >= 0 ? "positive" : "negative"}>
                    {signed(selected.changePercent)} · {selected.change >= 0 ? "+" : ""}
                    {price(selected.change)}
                  </em>
                  <dl>
                    <div>
                      <dt>HIGH</dt>
                      <dd>{selected.high === null ? "—" : price(selected.high)}</dd>
                    </div>
                    <div>
                      <dt>LOW</dt>
                      <dd>{selected.low === null ? "—" : price(selected.low)}</dd>
                    </div>
                    <div>
                      <dt>VOLUME</dt>
                      <dd>{compact(selected.volume)}</dd>
                    </div>
                    <div>
                      <dt>CCY</dt>
                      <dd>{selected.instrument.currency}</dd>
                    </div>
                  </dl>
                </div>
                <div className="ma-focus-chart">
                  <div className="ma-history-toolbar">
                    <div className="ma-chart-meta">
                      <span>{historyRange} · DAILY OHLCV</span>
                      <small>
                        {history.loading
                          ? "LOADING HISTORY"
                          : `${currentHistory?.bars.length ?? 0} BARS · ${currentHistory?.quality.toUpperCase() ?? "—"}`}
                      </small>
                    </div>
                    <nav aria-label="Historical range">
                      {(["1M", "3M", "6M", "1Y", "3Y"] as const).map((item) => (
                        <button
                          type="button"
                          key={item}
                          className={historyRange === item ? "active" : ""}
                          onClick={() => setHistoryRange(item)}
                        >
                          {item}
                        </button>
                      ))}
                    </nav>
                  </div>
                  <CandlestickChart bars={currentHistory?.bars ?? []} loading={history.loading} />
                  <div className="ma-history-source">
                    <span>{currentHistory?.source ?? "RESOLVING HISTORY PROVIDER"}</span>
                    <small>QFQ · DAILY · INFORMATIONAL</small>
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="ma-open-quant"
                onClick={openQuant}
                disabled={history.loading || (currentHistory?.bars.length ?? 0) < 30}
              >
                SEND {currentHistory?.bars.length ?? 0} BARS TO QUANT <ArrowUpRight />
              </button>
            </article>

            <aside className="ma-breadth-card">
              <div className="ma-section-label">
                <span>MARKET BREADTH</span>
                <small>A-SHARE UNIVERSE</small>
              </div>
              <div
                className="ma-breadth-orbit"
                style={
                  {
                    "--advance": `${(advancers / Math.max(1, landscape.breadth.total)) * 360}deg`,
                  } as React.CSSProperties
                }
              >
                <div>
                  <strong>
                    {Math.round((advancers / Math.max(1, landscape.breadth.total)) * 100)}%
                  </strong>
                  <span>ADVANCING</span>
                </div>
              </div>
              <div className="ma-breadth-counts">
                <span>
                  <i className="up" /> {advancers.toLocaleString("en-US")} ABOVE
                </span>
                <span>
                  <i className="down" /> {decliners.toLocaleString("en-US")} BELOW
                </span>
              </div>
              <p>
                Full A-share scan across {landscape.breadth.total.toLocaleString("en-US")} active
                listings. {landscape.breadth.unchanged.toLocaleString("en-US")} unchanged.
              </p>
            </aside>
          </section>
        )}

        <section className="ma-pulse-section">
          <div className="ma-section-heading">
            <div>
              <span>01</span>
              <h2>Global pulse</h2>
              <small>ASIA → AMERICAS</small>
            </div>
            <nav aria-label="Market region filter">
              {(["ALL", "CN", "HK", "US"] as const).map((item) => (
                <button
                  type="button"
                  key={item}
                  className={region === item ? "active" : ""}
                  onClick={() => setRegion(item)}
                >
                  {item}
                </button>
              ))}
            </nav>
          </div>
          <div className="ma-pulse-grid">
            {visibleQuotes.map((quote, index) => (
              <QuoteCard
                key={quote.instrument.id}
                quote={quote}
                index={index}
                selected={quote.instrument.id === selected?.instrument.id}
                watched={activeInstrumentIds.includes(quote.instrument.id)}
                onSelect={() => setSelectedId(quote.instrument.id)}
                onWatch={() => toggleWatch(quote.instrument.id)}
              />
            ))}
            {visibleQuotes.length === 0 && (
              <div className="ma-empty">NO INSTRUMENTS MATCH “{query.toUpperCase()}”</div>
            )}
          </div>
        </section>

        <MarketCartography
          snapshot={landscape}
          loading={landscapeRefreshing}
          onOpen={(instrument, ranking) => {
            const previousClose =
              ranking === undefined ? null : ranking.price / (1 + ranking.changePercent / 100);
            const fallbackQuote: QuoteSnapshot | undefined =
              ranking === undefined
                ? undefined
                : {
                    instrument,
                    price: ranking.price,
                    change: previousClose === null ? 0 : ranking.price - previousClose,
                    changePercent: ranking.changePercent,
                    previousClose,
                    high: null,
                    low: null,
                    volume: null,
                    amount: ranking.amount,
                    sourceTimestamp: null,
                    receivedAt: landscape.receivedAt,
                    quality: landscape.quality === "demo" ? "demo" : "delayed",
                    source: `${landscape.provider} · ranking fallback`,
                    sparkline: [previousClose ?? ranking.price, ranking.price],
                  };
            void selectSearchResult({ instrument, providerType: "MARKET SCAN" }, fallbackQuote);
          }}
        />

        {selected !== undefined && (
          <CorporateActions
            instrument={selected.instrument}
            series={dividends.series}
            loading={dividends.loading}
            error={dividends.error}
          />
        )}

        <section className="ma-lower-grid">
          <article className="ma-list-panel ma-futures-panel">
            <div className="ma-section-heading compact">
              <div>
                <span>04</span>
                <h2>Cross-asset tape</h2>
                <small>GLOBAL FUTURES</small>
              </div>
            </div>
            <div className="ma-futures-grid">
              {snapshot.futures.slice(0, 6).map((quote) => (
                <button
                  type="button"
                  key={quote.instrument.id}
                  onClick={() => setSelectedId(quote.instrument.id)}
                >
                  <span>{quote.instrument.shortName}</span>
                  <b>{price(quote.price)}</b>
                  <em className={quote.changePercent >= 0 ? "positive" : "negative"}>
                    {signed(quote.changePercent)}
                  </em>
                  <Sparkline values={quote.sparkline} positive={quote.changePercent >= 0} />
                </button>
              ))}
            </div>
          </article>

          <article className="ma-list-panel">
            <div className="ma-section-heading compact">
              <div>
                <span>05</span>
                <h2>Largest moves</h2>
                <small>ABSOLUTE CHANGE</small>
              </div>
            </div>
            <div className="ma-movers">
              {movers.map((quote, index) => (
                <button
                  type="button"
                  key={quote.instrument.id}
                  onClick={() => setSelectedId(quote.instrument.id)}
                >
                  <i>{String(index + 1).padStart(2, "0")}</i>
                  <span>
                    <b>{quote.instrument.shortName}</b>
                    <small>
                      {quote.instrument.market} · {quote.instrument.symbol}
                    </small>
                  </span>
                  <em className={quote.changePercent >= 0 ? "positive" : "negative"}>
                    {quote.changePercent >= 0 ? <TrendingUp /> : <TrendingDown />}
                    {signed(quote.changePercent)}
                  </em>
                </button>
              ))}
            </div>
          </article>

          <article className="ma-list-panel">
            <div className="ma-section-heading compact ma-watchlist-heading">
              <div>
                <span>06</span>
                <h2>Watchlist</h2>
                <small>
                  {watched.length} INSTRUMENTS · {activeGroup.name.toUpperCase()}
                </small>
              </div>
              <div className="ma-watchlist-actions">
                <button
                  type="button"
                  className="ma-watchlist-send"
                  onClick={() => void openWatchlistQuant()}
                  disabled={handoffLoading || watched.length === 0}
                >
                  {handoffLoading ? <RefreshCw className="spinning" /> : <ArrowUpRight />}
                  SEND GROUP
                </button>
                <button
                  type="button"
                  className="ma-watchlist-add"
                  onClick={() => setCreatingGroup((open) => !open)}
                  aria-label="Create watchlist group"
                  aria-expanded={creatingGroup}
                >
                  <Plus />
                </button>
              </div>
            </div>
            <div className="ma-watchlist-groups" role="tablist" aria-label="Watchlist groups">
              {watchlists.groups.map((group) => (
                <button
                  type="button"
                  role="tab"
                  key={group.id}
                  aria-selected={group.id === activeGroup.id}
                  className={group.id === activeGroup.id ? "active" : ""}
                  onClick={() => selectWatchlistGroup(group.id)}
                >
                  {group.name}
                  <small>{group.instrumentIds.length}</small>
                </button>
              ))}
            </div>
            {creatingGroup && (
              <form
                className="ma-watchlist-create"
                onSubmit={(event) => {
                  event.preventDefault();
                  createWatchlistGroup();
                }}
              >
                <input
                  autoFocus
                  aria-label="New watchlist group name"
                  value={newGroupName}
                  onChange={(event) => setNewGroupName(event.target.value)}
                  placeholder="New group name"
                  maxLength={24}
                />
                <button type="submit" disabled={newGroupName.trim().length === 0}>
                  CREATE
                </button>
              </form>
            )}
            <div className="ma-watchlist">
              {watched.map((quote) => (
                <button
                  type="button"
                  key={quote.instrument.id}
                  onClick={() => setSelectedId(quote.instrument.id)}
                >
                  <Star />
                  <span>
                    <b>{quote.instrument.shortName}</b>
                    <small>{quote.instrument.symbol}</small>
                  </span>
                  <strong>{price(quote.price)}</strong>
                  <em className={quote.changePercent >= 0 ? "positive" : "negative"}>
                    {signed(quote.changePercent)}
                  </em>
                </button>
              ))}
              {watched.length === 0 && <p>Star an instrument to keep it close.</p>}
            </div>
            {handoffError !== null && <p className="ma-watchlist-error">QUANT · {handoffError}</p>}
          </article>
        </section>

        <section className="ma-provider-panel">
          <div className="ma-provider-heading">
            <ShieldCheck />
            <div>
              <b>Source integrity</b>
              <span>Public feeds · delayed · informational use only</span>
            </div>
          </div>
          <div className="ma-feed-grid">
            {snapshot.feeds.map((feed) => (
              <div key={feed.market} className={feed.state}>
                <span>{feed.market}</span>
                <b>{feed.state.toUpperCase()}</b>
                <small>
                  {feed.itemCount} ITEMS · {feed.message}
                </small>
              </div>
            ))}
          </div>
          {snapshot.errors.length > 0 && (
            <p className="ma-provider-error">{snapshot.errors.slice(0, 2).join(" · ")}</p>
          )}
        </section>
      </main>

      <footer className="ma-footer">
        <span>
          <Clock3 /> AS OF {receivedTime(snapshot.receivedAt)}
        </span>
        <p>Prices may be delayed by seconds or minutes. Not for order execution.</p>
        <b>BCR / MARKET ATLAS 0.5</b>
      </footer>
    </div>
  );
}

function dividendYield(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(2)}%`;
}

type RankingMode = keyof MarketLandscapeSnapshot["rankings"];

const RANKING_LABELS: ReadonlyArray<{ key: RankingMode; label: string }> = [
  { key: "gainers", label: "LEADERS" },
  { key: "decliners", label: "LAGGARDS" },
  { key: "turnover", label: "TURNOVER" },
];

function rankingValue(item: MarketRankingItem, mode: RankingMode): string {
  return mode === "turnover" ? `¥${compact(item.amount)}` : signed(item.changePercent);
}

function MarketCartography(props: {
  snapshot: MarketLandscapeSnapshot;
  loading: boolean;
  onOpen: (instrument: MarketInstrument, ranking?: MarketRankingItem) => void;
}) {
  const [mode, setMode] = useState<RankingMode>("gainers");
  const items = props.snapshot.rankings[mode];
  const breadth = props.snapshot.breadth;
  const allRankings = [
    ...props.snapshot.rankings.gainers,
    ...props.snapshot.rankings.decliners,
    ...props.snapshot.rankings.turnover,
  ];

  return (
    <section className="ma-discovery-section">
      <div className="ma-section-heading">
        <div>
          <span>02</span>
          <h2>Market cartography</h2>
          <small>A-SHARE BREADTH / SECTORS / RANKINGS</small>
        </div>
        <div className={`ma-landscape-status ${props.snapshot.quality}`}>
          <i />
          {props.loading ? "SCANNING 5K+ LISTINGS" : qualityLabel(props.snapshot.quality)}
        </div>
      </div>

      <div className="ma-market-breadth-strip">
        <div>
          <span>UNIVERSE</span>
          <b>{breadth.total.toLocaleString("en-US")}</b>
          <small>ACTIVE LISTINGS</small>
        </div>
        <div className="positive">
          <span>ADVANCING</span>
          <b>{breadth.advancing.toLocaleString("en-US")}</b>
          <small>
            {((breadth.advancing / Math.max(1, breadth.total)) * 100).toFixed(1)}% OF TAPE
          </small>
        </div>
        <div className="negative">
          <span>DECLINING</span>
          <b>{breadth.declining.toLocaleString("en-US")}</b>
          <small>
            {((breadth.declining / Math.max(1, breadth.total)) * 100).toFixed(1)}% OF TAPE
          </small>
        </div>
        <div>
          <span>LIMIT PRESSURE</span>
          <b>
            {breadth.limitUp} <i>/</i> {breadth.limitDown}
          </b>
          <small>UP / DOWN</small>
        </div>
        <div>
          <span>TURNOVER</span>
          <b>¥{compact(breadth.amount)}</b>
          <small>AGGREGATED VALUE</small>
        </div>
      </div>

      <div className="ma-cartography-grid">
        <article className="ma-sector-panel">
          <header>
            <div>
              <BarChart3 />
              <span>INDUSTRY HEATMAP</span>
            </div>
            <small>EXTREMES BY ABSOLUTE CHANGE</small>
          </header>
          <div className="ma-sector-map">
            {props.snapshot.sectors.map((sector) => {
              const heat = Math.min(0.34, 0.075 + Math.abs(sector.changePercent) * 0.046);
              return (
                <button
                  type="button"
                  key={sector.code}
                  disabled={sector.leader === null}
                  onClick={() => {
                    if (sector.leader === null) return;
                    props.onOpen(
                      sector.leader,
                      allRankings.find((ranking) => ranking.instrument.id === sector.leader?.id),
                    );
                  }}
                  style={
                    {
                      "--sector-rgb": sector.changePercent >= 0 ? "199, 243, 106" : "255, 118, 109",
                      "--sector-heat": heat,
                    } as React.CSSProperties
                  }
                  aria-label={
                    sector.leader === null
                      ? `${sector.name} sector`
                      : `Open ${sector.leader.name}, leader of ${sector.name}`
                  }
                >
                  <span>
                    <i>{sector.code}</i>
                    <em className={sector.changePercent >= 0 ? "positive" : "negative"}>
                      {signed(sector.changePercent)}
                    </em>
                  </span>
                  <strong>{sector.name}</strong>
                  <small>
                    {sector.riseCount} ↑ · {sector.fallCount} ↓
                  </small>
                  <footer>
                    <span>
                      MAIN FLOW{" "}
                      {sector.mainNetInflow === null ? "—" : compact(sector.mainNetInflow)}
                    </span>
                    <b>{sector.leader?.shortName ?? "LEADER PENDING"}</b>
                  </footer>
                </button>
              );
            })}
          </div>
        </article>

        <aside className="ma-ranking-panel">
          <header>
            <span>MARKET RANK</span>
            <nav aria-label="A-share ranking mode">
              {RANKING_LABELS.map((item) => (
                <button
                  type="button"
                  key={item.key}
                  className={mode === item.key ? "active" : ""}
                  onClick={() => setMode(item.key)}
                >
                  {item.label}
                </button>
              ))}
            </nav>
          </header>
          <div className="ma-market-ranking">
            {items.map((item) => (
              <button
                type="button"
                key={`${mode}:${item.instrument.id}`}
                onClick={() => props.onOpen(item.instrument, item)}
              >
                <i>{String(item.rank).padStart(2, "0")}</i>
                <span>
                  <b>{item.instrument.shortName}</b>
                  <small>
                    {item.instrument.symbol} · {item.turnoverRate?.toFixed(2) ?? "—"}% TURN
                  </small>
                </span>
                <strong>{price(item.price)}</strong>
                <em
                  className={
                    mode === "turnover"
                      ? "turnover"
                      : item.changePercent >= 0
                        ? "positive"
                        : "negative"
                  }
                >
                  {rankingValue(item, mode)}
                  {mode === "turnover" && (
                    <small className={item.changePercent >= 0 ? "positive" : "negative"}>
                      {signed(item.changePercent)}
                    </small>
                  )}
                </em>
                <ChevronRight />
              </button>
            ))}
          </div>
        </aside>
      </div>
      <footer className="ma-landscape-source">
        <span>{props.snapshot.provider}</span>
        <small>
          {props.snapshot.errors[0] ??
            `SNAPSHOT ${receivedTime(props.snapshot.receivedAt)} · CLICK ANY RANK OR SECTOR LEADER TO DRILL IN`}
        </small>
      </footer>
    </section>
  );
}

function CorporateActions(props: {
  instrument: MarketInstrument;
  series: DividendSeries | null;
  loading: boolean;
  error: string | null;
}) {
  const events = props.series?.events ?? [];
  const latest = events.find((event) => event.cashPerTen !== null) ?? events[0];
  const supported = props.instrument.market === "CN" && props.instrument.assetClass === "equity";
  const source = props.series?.source ?? "";
  const isDemo = source.includes("· DEMO");
  const isCached = source.includes("CACHED");
  const coverageTone = props.loading
    ? "loading"
    : props.error !== null
      ? "degraded"
      : isDemo
        ? "demo"
        : isCached
          ? "cached"
          : (props.series?.coverage ?? "loading");
  const coverageLabel = props.loading
    ? "RESOLVING"
    : props.error !== null
      ? "DEGRADED"
      : isDemo
        ? "DEMO REFERENCE"
        : isCached
          ? "CACHED REFERENCE"
          : props.series?.coverage === "available"
            ? "A-SHARE REFERENCE ONLINE"
            : "COVERAGE BOUNDARY";

  return (
    <section
      className="ma-corporate-section"
      data-dividend-ledger
      data-dividend-coverage={coverageTone}
    >
      <div className="ma-section-heading">
        <div>
          <span>03</span>
          <h2>Income ledger</h2>
          <small>DIVIDENDS / CORPORATE ACTIONS</small>
        </div>
        <div className={`ma-coverage ${coverageTone}`}>
          <i />
          {coverageLabel}
        </div>
      </div>
      {props.loading ? (
        <div className="ma-corporate-state">
          <RefreshCw className="spinning" /> RESOLVING CORPORATE ACTIONS
        </div>
      ) : props.error !== null ? (
        <div className="ma-corporate-state error">DIVIDEND FEED · {props.error}</div>
      ) : latest !== undefined ? (
        <div className="ma-income-grid">
          <div className="ma-income-lead">
            <CircleDollarSign />
            <span>LATEST CASH PLAN</span>
            <strong>{latest.cashPerTen === null ? "DISCLOSED" : price(latest.cashPerTen)}</strong>
            <small>
              {latest.cashPerTen === null ? "SEE PLAN DESCRIPTION" : "CNY / 10 SHARES · PRE-TAX"}
            </small>
          </div>
          <dl className="ma-income-stats">
            <div>
              <dt>DECLARED YIELD</dt>
              <dd>{dividendYield(latest.dividendYield)}</dd>
            </div>
            <div>
              <dt>EX-DIVIDEND</dt>
              <dd>{latest.exDividendDate ?? "PENDING"}</dd>
            </div>
            <div>
              <dt>RECORD DATE</dt>
              <dd>{latest.recordDate ?? "PENDING"}</dd>
            </div>
            <div>
              <dt>STATUS</dt>
              <dd>{latest.status ?? "DISCLOSED"}</dd>
            </div>
          </dl>
          <div className="ma-dividend-timeline">
            {events.slice(0, 4).map((event, index) => (
              <article key={`${event.reportDate ?? "undated"}:${index}`}>
                <i>{String(index + 1).padStart(2, "0")}</i>
                <span>
                  <b>{event.description ?? "Dividend plan disclosed"}</b>
                  <small>
                    {event.reportDate ?? "REPORT DATE PENDING"} · {event.status ?? "DISCLOSED"}
                  </small>
                </span>
                <em>{dividendYield(event.dividendYield)}</em>
              </article>
            ))}
          </div>
          <footer>{props.series?.source} · REFERENCE DATA / NOT A FORWARD YIELD FORECAST</footer>
        </div>
      ) : (
        <div className="ma-corporate-state unsupported">
          <CalendarDays />
          <div>
            <b>
              {supported ? "NO DIVIDEND RECORDS RETURNED" : "COVERAGE STOPS AT A-SHARE EQUITIES"}
            </b>
            <span>
              {supported
                ? "The provider returned an empty corporate-action ledger for this instrument."
                : "HK / US cash distributions and fund NAV distributions remain explicit next-provider work."}
            </span>
          </div>
          <small>
            {props.instrument.market} · {props.instrument.assetClass.toUpperCase()}
          </small>
        </div>
      )}
    </section>
  );
}

function Session(props: { session: MarketSession; index: number }) {
  return (
    <div className={`ma-session ${props.session.state}`}>
      <i>{String(props.index).padStart(2, "0")}</i>
      <div>
        <span>{props.session.city}</span>
        <small>{props.session.venue}</small>
      </div>
      <b>{props.session.localTime}</b>
      <em>{sessionLabel(props.session.state)}</em>
    </div>
  );
}

function QuoteCard(props: {
  quote: QuoteSnapshot;
  index: number;
  selected: boolean;
  watched: boolean;
  onSelect: () => void;
  onWatch: () => void;
}) {
  const positive = props.quote.changePercent >= 0;
  return (
    <article
      className={`ma-quote-card ${props.selected ? "selected" : ""}`}
      style={{ "--delay": `${props.index * 35}ms` } as React.CSSProperties}
    >
      <button type="button" className="ma-quote-main" onClick={props.onSelect}>
        <span className="ma-quote-market">
          {props.quote.instrument.market} · {props.quote.instrument.symbol}
        </span>
        <b>{props.quote.instrument.shortName}</b>
        <strong>{price(props.quote.price)}</strong>
        <em className={positive ? "positive" : "negative"}>{signed(props.quote.changePercent)}</em>
        <Sparkline values={props.quote.sparkline} positive={positive} />
      </button>
      <button
        type="button"
        className={`ma-card-star ${props.watched ? "watched" : ""}`}
        onClick={props.onWatch}
        aria-label={`Watch ${props.quote.instrument.name}`}
      >
        <Star />
      </button>
    </article>
  );
}
