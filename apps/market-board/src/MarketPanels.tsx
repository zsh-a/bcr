import {
  BarChart3,
  CalendarDays,
  ChevronRight,
  CircleDollarSign,
  RefreshCw,
  Star,
} from "lucide-react";
import { useState } from "react";
import type {
  DividendSeries,
  MarketInstrument,
  MarketLandscapeSnapshot,
  MarketRankingItem,
  MarketSession,
  QuoteSnapshot,
} from "@bcr/market-data";
import { Sparkline } from "./components/Sparkline";
import { compact, price, qualityLabel, receivedTime, sessionLabel, signed } from "./marketFormat";

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

export function MarketCartography(props: {
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
          <span>03</span>
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

export function CorporateActions(props: {
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
          <span>01</span>
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

export function Session(props: { session: MarketSession; index: number }) {
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

export function QuoteCard(props: {
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
