import { marketInstrumentName } from "@bcr/market-data";
import { Star } from "lucide-react";
import type { QuoteSnapshot } from "@bcr/market-data";
import { Sparkline } from "../components/Sparkline";
import { price, signed, qualityLabel } from "../data/marketFormat";
import type { QuoteTrendResource } from "./useQuoteTrends";

export function QuoteCard(props: {
  quote: QuoteSnapshot;
  trend: QuoteTrendResource | undefined;
  index: number;
  selected: boolean;
  watched: boolean;
  onSelect: () => void;
  onWatch: () => void;
}) {
  const positive = props.quote.changePercent >= 0;
  const trend = props.quote.quality === "demo" ? null : props.trend?.series;
  const values = trend?.points.map((point) => point.close) ?? [];
  const period = `近${values.length}日${trend?.quality === "cached" ? " · 缓存" : ""}`;
  const description = trend
    ? `${period}收盘价走势，${trend.points[0]!.date} 至 ${trend.points.at(-1)!.date}，${trend.source}`
    : "暂无真实历史价格走势";
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
        {trend ? (
          <span className="ma-quote-trend" role="img" aria-label={description} title={description}>
            <Sparkline values={values} positive={values.at(-1)! >= values[0]!} />
            <span>{period}</span>
          </span>
        ) : (
          <span className="ma-trend-status">
            {props.quote.quality !== "demo" && props.trend?.loading ? "加载走势…" : "暂无走势"}
          </span>
        )}
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
