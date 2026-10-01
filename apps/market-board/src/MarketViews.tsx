import { marketInstrumentName } from "@bcr/market-data";
import { useEffect, useState } from "react";
import type {
  MarketLandscapeSnapshot,
  MarketRankingItem,
  MarketSectorPulse,
  MarketInstrument,
  QuoteSnapshot,
  DataQuality,
} from "@bcr/market-data";
import { Button, Drawer, EmptyState, Input, Spinner } from "@bcr/react";
import { ChevronRight, Star } from "lucide-react";
import { compact, price, qualityLabel, receivedTime, signed } from "./marketFormat";
import { marketProvider } from "./marketServices";

export function DataStamp({
  source,
  quality,
  at,
}: {
  source: string;
  quality: DataQuality;
  at: number;
}) {
  return (
    <div className={`ma-data-stamp ${quality}`}>
      <span>
        <i />
        {qualityLabel(quality)}
      </span>
      <span>{source}</span>
      <time dateTime={new Date(at).toISOString()}>
        {new Date(at).toLocaleDateString()} {receivedTime(at)}
      </time>
    </div>
  );
}
export function BreadthSummary({ snapshot }: { snapshot: MarketLandscapeSnapshot }) {
  const b = snapshot.breadth;
  return (
    <section className="ma-overview-summary" aria-label="A 股市场概况">
      <div className="ma-section-heading">
        <h2>A 股市场</h2>
        <span>当日涨跌分布</span>
      </div>
      <dl className="ma-market-breadth-strip">
        {[
          ["上涨", b.advancing, "positive"],
          ["下跌", b.declining, "negative"],
          ["平盘", b.unchanged, ""],
          ["涨停 / 跌停", `${b.limitUp} / ${b.limitDown}`, ""],
          ["成交额", `¥${compact(b.amount)}`, ""],
        ].map(([label, value, tone]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className={String(tone)}>
              {typeof value === "number" ? value.toLocaleString() : value}
            </dd>
          </div>
        ))}
      </dl>
      <div
        className="ma-distribution"
        aria-label={`上涨 ${b.advancing}，下跌 ${b.declining}，平盘 ${b.unchanged}`}
      >
        <i style={{ flex: b.advancing }} />
        <i style={{ flex: b.declining }} />
        <i style={{ flex: b.unchanged }} />
      </div>
      <DataStamp source={snapshot.provider} quality={snapshot.quality} at={snapshot.receivedAt} />
    </section>
  );
}
export function RankingList({
  snapshot,
  onOpen,
}: {
  snapshot: MarketLandscapeSnapshot;
  onOpen: (instrument: MarketInstrument, ranking?: MarketRankingItem) => void;
}) {
  const [mode, setMode] = useState<keyof MarketLandscapeSnapshot["rankings"]>("gainers");
  return (
    <section className="ma-ranking-panel">
      <div className="ma-section-heading">
        <h2>市场排行</h2>
        <nav aria-label="排行方式">
          {(
            [
              ["gainers", "涨幅"],
              ["decliners", "跌幅"],
              ["turnover", "成交额"],
            ] as const
          ).map(([key, label]) => (
            <Button
              key={key}
              variant="ghost"
              size="sm"
              aria-pressed={mode === key}
              onClick={() => setMode(key)}
            >
              {label}
            </Button>
          ))}
        </nav>
      </div>
      <div className="ma-market-ranking">
        {snapshot.rankings[mode].map((item) => (
          <button
            type="button"
            key={item.instrument.id}
            onClick={() => onOpen(item.instrument, item)}
          >
            <i>{item.rank}</i>
            <span>
              <b>{marketInstrumentName(item.instrument)}</b>
              <small>{item.instrument.symbol}</small>
            </span>
            <strong>{price(item.price)}</strong>
            <em className={item.changePercent >= 0 ? "positive" : "negative"}>
              {mode === "turnover" ? `¥${compact(item.amount)}` : signed(item.changePercent)}
            </em>
            <ChevronRight size={14} />
          </button>
        ))}
      </div>
      {!snapshot.rankings[mode].length && (
        <EmptyState title="暂无排行数据" description="等待下一次行情更新。" />
      )}
      <DataStamp source={snapshot.provider} quality={snapshot.quality} at={snapshot.receivedAt} />
    </section>
  );
}
export function SectorMap({
  sectors,
  onSelect,
}: {
  sectors: readonly MarketSectorPulse[];
  onSelect: (sector: MarketSectorPulse) => void;
}) {
  return (
    <div className="ma-sector-map">
      {sectors.map((sector) => (
        <button
          type="button"
          key={sector.code}
          onClick={() => onSelect(sector)}
          aria-label={`查看${sector.name}行业`}
          style={{
            background: `color-mix(in srgb, ${sector.changePercent >= 0 ? "var(--color-success)" : "var(--color-danger)"} ${Math.min(28, 8 + Math.abs(sector.changePercent) * 4)}%, var(--color-surface))`,
          }}
        >
          <span>
            <b>{sector.name}</b>
            <small>{sector.code}</small>
          </span>
          <strong className={sector.changePercent >= 0 ? "positive" : "negative"}>
            {signed(sector.changePercent)}
          </strong>
          <footer>
            <span>
              {sector.riseCount} 涨 · {sector.fallCount} 跌
            </span>
            <span>净流入 {compact(sector.mainNetInflow)}</span>
          </footer>
        </button>
      ))}
    </div>
  );
}
export function SectorView({
  snapshot,
  onSelect,
}: {
  snapshot: MarketLandscapeSnapshot;
  onSelect: (sector: MarketSectorPulse) => void;
}) {
  const [query, setQuery] = useState(""),
    [sort, setSort] = useState<"change" | "flow" | "name">("change");
  const sectors = snapshot.sectors
    .filter((s) => `${s.name} ${s.code}`.toLowerCase().includes(query.trim().toLowerCase()))
    .toSorted((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name, "zh")
        : sort === "flow"
          ? (b.mainNetInflow ?? -Infinity) - (a.mainNetInflow ?? -Infinity)
          : b.changePercent - a.changePercent,
    );
  return (
    <section>
      <div className="ma-view-heading">
        <div>
          <h1>行业表现</h1>
          <p>当日涨跌幅 · 东方财富行业分类 · {snapshot.sectors.length} 个行业</p>
        </div>
      </div>
      <div className="ma-sector-toolbar">
        <Input
          value={query}
          aria-label="搜索行业"
          placeholder="搜索行业名称或代码"
          onChange={(e) => setQuery(e.target.value)}
        />
        <nav aria-label="行业排序">
          {(
            [
              ["change", "涨跌幅"],
              ["flow", "资金流"],
              ["name", "名称"],
            ] as const
          ).map(([key, label]) => (
            <Button
              key={key}
              size="sm"
              variant="ghost"
              aria-pressed={sort === key}
              onClick={() => setSort(key)}
            >
              {label}
            </Button>
          ))}
        </nav>
      </div>
      <DataStamp source={snapshot.provider} quality={snapshot.quality} at={snapshot.receivedAt} />
      <SectorMap sectors={sectors} onSelect={onSelect} />
      {!sectors.length && (
        <EmptyState title="没有匹配的行业" description="试试其他名称，或刷新行情。" />
      )}
      <p className="ma-caption">
        颜色代表当日涨跌幅；点击行业查看成分股。历史 MA20 宽度在「宽度」中查看。
      </p>
    </section>
  );
}
export function SectorDetail({
  sector,
  onClose,
  onOpen,
}: {
  sector: MarketSectorPulse | null;
  onClose: () => void;
  onOpen: (instrument: MarketInstrument, ranking?: MarketRankingItem) => void;
}) {
  const [members, setMembers] = useState<MarketRankingItem[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [page, setPage] = useState(0),
    [receivedAt, setReceivedAt] = useState<number | null>(null);
  useEffect(() => {
    if (!sector) return;
    let disposed = false;
    const abort = new AbortController();
    setMembers([]);
    setPage(0);
    setReceivedAt(null);
    setLoading(true);
    setError("");
    void marketProvider
      .loadSectorMembers(sector.code, abort.signal)
      .then((rows) => {
        if (!disposed) {
          setMembers(rows);
          setReceivedAt(Date.now());
        }
      })
      .catch((e) => {
        if (!disposed) setError(String(e));
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
      abort.abort();
    };
  }, [sector?.code]);
  return (
    <Drawer
      open={sector !== null}
      onClose={onClose}
      title={sector ? sector.name : "行业详情"}
      className="ma-sector-detail"
    >
      {sector && (
        <>
          <p className="ma-caption">{sector.code} · 东方财富行业分类 · 当日成分股</p>
          <dl className="ma-detail-metrics">
            <div>
              <dt>涨跌幅</dt>
              <dd className={sector.changePercent >= 0 ? "positive" : "negative"}>
                {signed(sector.changePercent)}
              </dd>
            </div>
            <div>
              <dt>涨 / 跌</dt>
              <dd>
                {sector.riseCount} / {sector.fallCount}
              </dd>
            </div>
            <div>
              <dt>主力净流入</dt>
              <dd>{compact(sector.mainNetInflow)}</dd>
            </div>
          </dl>
          {loading && (
            <p className="ma-operation" role="status">
              <Spinner size="sm" />
              正在加载成分股…
            </p>
          )}
          {error && (
            <p className="ma-error" role="alert">
              {error}
            </p>
          )}
          {receivedAt !== null && (
            <DataStamp source="stock-sdk · 东方财富行业成分" quality="delayed" at={receivedAt} />
          )}
          <div className="ma-member-list">
            {members.slice(page * 50, (page + 1) * 50).map((item) => (
              <button
                type="button"
                key={item.instrument.id}
                onClick={() => onOpen(item.instrument, item)}
              >
                <span>
                  <b>{marketInstrumentName(item.instrument)}</b>
                  <small>{item.instrument.symbol}</small>
                </span>
                <strong>{price(item.price)}</strong>
                <em className={item.changePercent >= 0 ? "positive" : "negative"}>
                  {signed(item.changePercent)}
                </em>
                <ChevronRight size={14} />
              </button>
            ))}
          </div>
          {!loading && !error && !members.length && (
            <EmptyState title="暂无成分股数据" description="该行业暂未返回可用行情。" />
          )}
          {members.length > 50 && (
            <div className="ma-section-heading">
              <span>{members.length} 只证券</span>
              <div>
                <Button size="sm" disabled={!page} onClick={() => setPage((p) => p - 1)}>
                  上一页
                </Button>
                <span>
                  {page + 1} / {Math.ceil(members.length / 50)}
                </span>
                <Button
                  size="sm"
                  disabled={(page + 1) * 50 >= members.length}
                  onClick={() => setPage((p) => p + 1)}
                >
                  下一页
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </Drawer>
  );
}
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
