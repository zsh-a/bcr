import { useState } from "react";
import type { MarketLandscapeSnapshot, MarketSectorPulse } from "@bcr/market-data";
import { Button, EmptyState, Input } from "@bcr/react";
import { DataStamp } from "../components/DataStamp";
import { SectorMap } from "./SectorMap";

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
