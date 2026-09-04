import "@fontsource-variable/newsreader/wght.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import type { HistoryRange, QuoteSnapshot } from "@bcr/market-data";
import { publishQuantHandoff } from "@bcr/market-data";
import {
  ArrowUpRight,
  ChevronRight,
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
import { useState } from "react";
import { Sparkline } from "./components/Sparkline";
import { CandlestickChart } from "./components/CandlestickChart";
import { CorporateActions, MarketCartography, QuoteCard, Session } from "./MarketPanels";
import { compact, price, qualityLabel, receivedTime, signed } from "./marketFormat";
import { historyService } from "./marketServices";
import { useDividends } from "./useDividends";
import { useMarketAtlas } from "./useMarketAtlas";
import { useMarketDiscovery } from "./useMarketDiscovery";
import { useMarketHistory } from "./useMarketHistory";
import { useMarketLandscape } from "./useMarketLandscape";
import { useMarketWatchlists } from "./useMarketWatchlists";
import "./styles.css";

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
  const [historyRange, setHistoryRange] = useState<HistoryRange>("1Y");
  const [handoffLoading, setHandoffLoading] = useState(false);
  const [handoffError, setHandoffError] = useState<string | null>(null);
  const {
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
  } = useMarketDiscovery(snapshot.quotes, snapshot.futures);
  const {
    watchlists,
    activeGroup,
    newGroupName,
    creatingGroup,
    setNewGroupName,
    setCreatingGroup,
    toggleWatch,
    selectGroup: selectWatchlistGroup,
    createGroup: createWatchlistGroup,
  } = useMarketWatchlists();
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
            <CorporateActions
              instrument={selected.instrument}
              series={dividends.series}
              loading={dividends.loading}
              error={dividends.error}
            />
          </section>
        )}

        <section className="ma-pulse-section">
          <div className="ma-section-heading">
            <div>
              <span>02</span>
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
