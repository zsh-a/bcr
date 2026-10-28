import { useMemo, useState } from "react";
import { Pin, Search } from "lucide-react";
import { Button, Drawer, Input } from "@bcr/react";
import type { EconomicRepository } from "@bcr/market-data/economy";

export function MetricLibrary({
  open,
  onClose,
  repository,
  countries,
  pins,
  onPin,
  onInspect,
}: {
  open: boolean;
  onClose: () => void;
  repository: EconomicRepository;
  countries: string[];
  pins: string[];
  onPin: (metric: string) => void;
  onInspect: (metric: string) => void;
}) {
  const [query, setQuery] = useState("");
  const metrics = useMemo(
    () =>
      repository.metrics.filter((metric) =>
        `${metric.name} ${metric.id} ${metric.description}`
          .toLocaleLowerCase()
          .includes(query.toLocaleLowerCase()),
      ),
    [repository, query],
  );
  return (
    <Drawer open={open} onClose={onClose} title="指标与钉选" className="research-library">
      <div className="research-drawer-intro">
        <p>钉选指标会随主题保留，最多 8 项。国家、观察日期和时间窗口共用当前研究条件。</p>
        <label className="research-search">
          <Search size={15} />
          <Input
            aria-label="搜索宏观指标"
            placeholder="搜索指标、主题或来源域"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <small>
          已钉选 {pins.length}/8 · {metrics.length} 项匹配
        </small>
      </div>
      <div className="research-metric-list">
        {metrics.map((metric) => {
          const pinned = pins.includes(metric.id),
            count = countries.filter((country) => metric.countries.includes(country)).length;
          return (
            <article key={metric.id}>
              <button
                type="button"
                className="research-library-title"
                onClick={() => onInspect(metric.id)}
              >
                {metric.name}
                <small>
                  {metric.domain === "annual"
                    ? "年度背景"
                    : metric.domain === "debt"
                      ? "债务与融资"
                      : "周期与活动"}{" "}
                  · {count}/{countries.length} 国已收录
                </small>
              </button>
              <p>{metric.description}</p>
              <Button
                size="sm"
                variant={pinned ? "default" : "ghost"}
                aria-pressed={pinned}
                disabled={!pinned && pins.length >= 8}
                onClick={() => onPin(metric.id)}
              >
                <Pin size={12} />
                {pinned ? "取消钉选" : "钉选到工作台"}
              </Button>
            </article>
          );
        })}
      </div>
    </Drawer>
  );
}
