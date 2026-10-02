import { marketInstrumentName } from "@bcr/market-data";
import { useEffect, useState } from "react";
import type { MarketRankingItem, MarketSectorPulse, MarketInstrument } from "@bcr/market-data";
import { Button, Drawer, EmptyState, Spinner } from "@bcr/react";
import { ChevronRight } from "lucide-react";
import { compact, price, signed } from "../data/marketFormat";
import { marketProvider } from "../data/marketServices";
import { DataStamp } from "../components/DataStamp";

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
              <span className="ma-operation-message">正在加载成分股…</span>
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
