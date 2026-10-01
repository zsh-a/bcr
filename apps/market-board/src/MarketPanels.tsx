import { marketInstrumentName } from "@bcr/market-data";
import { Star } from "lucide-react";
import type { MarketSession, QuoteSnapshot } from "@bcr/market-data";
import { Sparkline } from "./components/Sparkline";
import { price, sessionLabel, signed, qualityLabel } from "./marketFormat";
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
      style={{ "--i": String(props.index) } as React.CSSProperties}
    >
      <button type="button" className="ma-quote-main" onClick={props.onSelect}>
        <span className="ma-quote-market">
          {props.quote.instrument.market} · {props.quote.instrument.symbol}
        </span>
        <b>{marketInstrumentName(props.quote.instrument)}</b>
        <small>{qualityLabel(props.quote.quality)}</small>
        <strong>{price(props.quote.price)}</strong>
        <em className={positive ? "positive" : "negative"}>{signed(props.quote.changePercent)}</em>
        <Sparkline values={props.quote.sparkline} positive={positive} />
      </button>
      <button
        type="button"
        className={`ma-card-star ui-btn ui-btn-ghost ui-btn-lg ui-icon-btn ${
          props.watched ? "watched" : ""
        }`}
        onClick={props.onWatch}
        aria-label={`自选 ${props.quote.instrument.name}`}
      >
        <Star />
      </button>
    </article>
  );
}
