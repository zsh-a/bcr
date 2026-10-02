import { marketInstrumentName } from "@bcr/market-data";
import { useState } from "react";
import type {
  MarketLandscapeSnapshot,
  MarketRankingItem,
  MarketInstrument,
} from "@bcr/market-data";
import { Button, EmptyState } from "@bcr/react";
import { ChevronRight } from "lucide-react";
import { compact, price, signed } from "../data/marketFormat";
import { DataStamp } from "../components/DataStamp";

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
