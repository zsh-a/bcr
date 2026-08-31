import "@fontsource-variable/newsreader/wght.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import type {
  DataQuality,
  MarketRegion,
  MarketSession,
  QuoteSnapshot,
  SessionState,
} from "@bcr/market-data";
import {
  ArrowUpRight,
  Clock3,
  Globe2,
  RefreshCw,
  Search,
  ShieldCheck,
  Star,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Sparkline } from "./components/Sparkline";
import { useMarketAtlas } from "./useMarketAtlas";
import "./styles.css";

const WATCHLIST_KEY = "bcr.market-atlas.watchlist.v1";
const DEFAULT_WATCHLIST = ["CN:SSE:000300", "HK:HKEX:HSI", "US:INDEX:INX"];

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

function initialWatchlist(): ReadonlyArray<string> {
  try {
    const saved = localStorage.getItem(WATCHLIST_KEY);
    return saved === null ? DEFAULT_WATCHLIST : (JSON.parse(saved) as ReadonlyArray<string>);
  } catch {
    return DEFAULT_WATCHLIST;
  }
}

export function App() {
  const { snapshot, refreshing, refresh } = useMarketAtlas();
  const [selectedId, setSelectedId] = useState("US:INDEX:INX");
  const [region, setRegion] = useState<MarketRegion | "ALL">("ALL");
  const [query, setQuery] = useState("");
  const [watchlist, setWatchlist] = useState<ReadonlyArray<string>>(initialWatchlist);
  const searchRef = useRef<HTMLInputElement>(null);
  const allQuotes = useMemo(() => [...snapshot.quotes, ...snapshot.futures], [snapshot]);
  const selected =
    allQuotes.find((quote) => quote.instrument.id === selectedId) ?? snapshot.quotes[0];
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
  const watched = watchlist.flatMap((id) => {
    const found = allQuotes.find((quote) => quote.instrument.id === id);
    return found === undefined ? [] : [found];
  });
  const advancers = snapshot.quotes.filter((quote) => quote.changePercent >= 0).length;
  const decliners = snapshot.quotes.length - advancers;

  useEffect(() => {
    try {
      localStorage.setItem(WATCHLIST_KEY, JSON.stringify(watchlist));
    } catch {
      // Watchlist remains available for this session when persistent storage is blocked.
    }
  }, [watchlist]);

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
    setWatchlist((items) =>
      items.includes(id) ? items.filter((item) => item !== id) : [...items, id],
    );
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
        <div className="ma-search">
          <Search />
          <input
            ref={searchRef}
            aria-label="Search markets"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search instrument or symbol"
          />
          <kbd>/</kbd>
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
                  className={watchlist.includes(selected.instrument.id) ? "watched" : ""}
                  onClick={() => toggleWatch(selected.instrument.id)}
                  aria-label="Toggle watchlist"
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
                  <div className="ma-chart-meta">
                    <span>PREVIOUS CLOSE → LAST</span>
                    <small>
                      {selected.quality.toUpperCase()} · {selected.source}
                    </small>
                  </div>
                  <Sparkline
                    values={selected.sparkline}
                    positive={selected.changePercent >= 0}
                    large
                  />
                </div>
              </div>
              <button
                type="button"
                className="ma-open-quant"
                onClick={() => window.location.assign("/quant")}
              >
                OPEN QUANT LAB <ArrowUpRight />
              </button>
            </article>

            <aside className="ma-breadth-card">
              <div className="ma-section-label">
                <span>MARKET BREADTH</span>
                <small>PULSE SET</small>
              </div>
              <div
                className="ma-breadth-orbit"
                style={
                  {
                    "--advance": `${(advancers / Math.max(1, snapshot.quotes.length)) * 360}deg`,
                  } as React.CSSProperties
                }
              >
                <div>
                  <strong>{advancers}</strong>
                  <span>ADVANCING</span>
                </div>
              </div>
              <div className="ma-breadth-counts">
                <span>
                  <i className="up" /> {advancers} ABOVE
                </span>
                <span>
                  <i className="down" /> {decliners} BELOW
                </span>
              </div>
              <p>Directional breadth across the current multi-market pulse set.</p>
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
                watched={watchlist.includes(quote.instrument.id)}
                onSelect={() => setSelectedId(quote.instrument.id)}
                onWatch={() => toggleWatch(quote.instrument.id)}
              />
            ))}
            {visibleQuotes.length === 0 && (
              <div className="ma-empty">NO INSTRUMENTS MATCH “{query.toUpperCase()}”</div>
            )}
          </div>
        </section>

        <section className="ma-lower-grid">
          <article className="ma-list-panel ma-futures-panel">
            <div className="ma-section-heading compact">
              <div>
                <span>02</span>
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
                <span>03</span>
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
            <div className="ma-section-heading compact">
              <div>
                <span>04</span>
                <h2>Watchlist</h2>
                <small>{watched.length} INSTRUMENTS</small>
              </div>
            </div>
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
        <b>BCR / MARKET ATLAS 0.1</b>
      </footer>
    </div>
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
