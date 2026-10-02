import { marketInstrumentName } from "@bcr/market-data";
import { useState } from "react";
import { Button, Dialog, EmptyState, Spinner } from "@bcr/react";
import { Star } from "lucide-react";
import type { HistoryRange, QuoteSnapshot } from "@bcr/market-data";
import { CandlestickChart } from "../components/CandlestickChart";
import { DataStamp } from "../components/DataStamp";
import { useMarketHistory } from "./useMarketHistory";
import { useDividends } from "./useDividends";
import { compact, price, signed } from "../data/marketFormat";

export function StockDetail({
  open,
  quote,
  loading,
  error,
  onClose,
  watched,
  onWatch,
}: {
  open: boolean;
  quote: QuoteSnapshot | undefined;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  watched: boolean;
  onWatch: () => void;
}) {
  const [range, setRange] = useState<HistoryRange>("1Y"),
    [tab, setTab] = useState<"history" | "dividends">("history");
  const history = useMarketHistory(
    open && !loading && tab === "history" ? quote : undefined,
    range,
  );
  const dividend = useDividends(
    open && !loading && tab === "dividends" ? quote?.instrument : undefined,
  );
  const series =
    history.series?.instrument.id === quote?.instrument.id && history.series?.range === range
      ? history.series
      : null;
  const actions = dividend.series;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={loading ? "加载证券…" : quote ? marketInstrumentName(quote.instrument) : "证券详情"}
      className="ma-stock-detail"
    >
      {loading ? (
        <p className="ma-operation" role="status">
          <Spinner size="sm" />
          <span className="ma-operation-message">正在获取行情…</span>
        </p>
      ) : (
        quote && (
          <>
            <div className="ma-stock-heading">
              <div>
                <p className="ma-caption">
                  {quote.instrument.symbol} · {quote.instrument.venue} · {quote.instrument.currency}
                </p>
                <strong>{price(quote.price)}</strong>
                <em className={quote.changePercent >= 0 ? "positive" : "negative"}>
                  {signed(quote.changePercent)}
                </em>
              </div>
              <Button variant="ghost" aria-pressed={watched} onClick={onWatch}>
                <Star size={16} />
                {watched ? "已自选" : "加入自选"}
              </Button>
            </div>
            <DataStamp
              source={quote.source}
              quality={quote.quality}
              at={quote.sourceTimestamp ?? quote.receivedAt}
            />
            <dl className="ma-detail-metrics">
              {[
                ["最高", quote.high === null ? "—" : price(quote.high)],
                ["最低", quote.low === null ? "—" : price(quote.low)],
                ["成交量", compact(quote.volume)],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <div className="ma-section-heading">
              <nav aria-label="证券详情视图">
                <Button
                  variant="ghost"
                  aria-pressed={tab === "history"}
                  onClick={() => setTab("history")}
                >
                  历史行情
                </Button>
                <Button
                  variant="ghost"
                  aria-pressed={tab === "dividends"}
                  onClick={() => setTab("dividends")}
                >
                  分红
                </Button>
              </nav>
              {tab === "history" && (
                <nav aria-label="历史区间">
                  {(["1M", "3M", "6M", "1Y", "3Y"] as const).map((item) => (
                    <Button
                      size="sm"
                      variant="ghost"
                      key={item}
                      aria-pressed={range === item}
                      onClick={() => setRange(item)}
                    >
                      {item}
                    </Button>
                  ))}
                </nav>
              )}
            </div>
            {tab === "history" ? (
              <>
                <CandlestickChart
                  bars={series?.bars ?? []}
                  loading={history.loading}
                  onRetry={() => void history.refresh()}
                />
                {series && (
                  <DataStamp
                    source={`${series.source} · 前复权日线 · ${series.bars.length} 条`}
                    quality={series.quality}
                    at={series.receivedAt}
                  />
                )}
              </>
            ) : (
              <section data-dividend-ledger>
                {dividend.loading ? (
                  <p className="ma-operation" role="status">
                    <Spinner size="sm" />
                    <span className="ma-operation-message">正在加载分红记录…</span>
                  </p>
                ) : actions && actions.events.length > 0 ? (
                  <>
                    <div className="ma-dividend-timeline">
                      {actions.events.slice(0, 12).map((event, index) => (
                        <article key={`${event.reportDate}:${index}`}>
                          <span>
                            <b>{event.description ?? "现金分红"}</b>
                            <small>
                              {event.reportDate ?? "日期未知"} · {event.status ?? "已披露"}
                            </small>
                          </span>
                          <strong>
                            {event.cashPerTen === null ? "—" : `${event.cashPerTen} 元 / 10 股`}
                          </strong>
                        </article>
                      ))}
                    </div>
                    <DataStamp
                      source={`${actions.source} · 参考分红记录`}
                      quality={actions.quality ?? "partial"}
                      at={actions.receivedAt}
                    />
                  </>
                ) : (
                  <EmptyState
                    title="暂无分红记录"
                    description={
                      quote.instrument.market === "CN"
                        ? "数据源未返回可用记录。"
                        : "当前分红数据源覆盖 A 股股票。"
                    }
                  />
                )}{" "}
                {dividend.error && (
                  <p role="alert" className="ma-error">
                    {dividend.error}
                  </p>
                )}
              </section>
            )}
          </>
        )
      )}
      {error && (
        <p className="ma-error" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}
