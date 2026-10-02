import { marketInstrumentName } from "@bcr/market-data";
import type { QuoteSnapshot } from "@bcr/market-data";
import { Button } from "@bcr/react";
import { Star } from "lucide-react";
import { price, qualityLabel, signed } from "../data/marketFormat";

export function WatchRows({
  quotes,
  watched,
  onOpen,
  onWatch,
}: {
  quotes: QuoteSnapshot[];
  watched: readonly string[];
  onOpen: (quote: QuoteSnapshot) => void;
  onWatch: (id: string) => void;
}) {
  return (
    <div className="ma-watch-rows">
      {quotes.map((quote) => (
        <div key={quote.instrument.id}>
          <button type="button" onClick={() => onOpen(quote)}>
            <span>
              <b>{marketInstrumentName(quote.instrument)}</b>
              <small>
                {quote.instrument.symbol} · {qualityLabel(quote.quality)}
              </small>
            </span>
            <strong>{price(quote.price)}</strong>
            <em className={quote.changePercent >= 0 ? "positive" : "negative"}>
              {signed(quote.changePercent)}
            </em>
          </button>
          <Button
            variant="ghost"
            className="ui-icon-btn"
            aria-label={`移除自选 ${marketInstrumentName(quote.instrument)}`}
            aria-pressed={watched.includes(quote.instrument.id)}
            onClick={() => onWatch(quote.instrument.id)}
          >
            <Star size={16} />
          </Button>
        </div>
      ))}
    </div>
  );
}
