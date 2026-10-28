import { ArrowRight, ArrowUpRight, CalendarDays, Focus, History } from "lucide-react";
import { Button } from "@bcr/react";
import { formatMacroValue, getMacroSeries, type MacroSnapshot } from "@bcr/market-data/macro";
import {
  MACRO_EVENT_CATEGORIES,
  MACRO_EVENT_CATALOG_UPDATED_AT,
  MACRO_EVENT_LATEST_DATE,
  type MacroEvent,
  type MacroEventCategory,
} from "@bcr/market-data/macro/events";
import { eventDateLabel, SERIES_TOKENS } from "./state";

export function EventPanels({
  snapshot,
  events,
  countries,
  selected,
  category,
  onCategory,
  onSelect,
  onRecent,
}: {
  snapshot: MacroSnapshot;
  events: MacroEvent[];
  countries: string[];
  selected: MacroEvent | undefined;
  category: MacroEventCategory | "all";
  onCategory: (category: MacroEventCategory | "all") => void;
  onSelect: (event: MacroEvent) => void;
  onRecent: () => void;
}) {
  return (
    <section className="macro-history-section" aria-label="历史事件研究">
      <div className="macro-section-heading">
        <div>
          <span className="macro-eyebrow">HISTORY LAYER</span>
          <h2>
            让数字回到历史现场 <span>{events.length}</span>
          </h2>
        </div>
        <span className="macro-caption">
          按当前国家与年度窗口筛选 · 精选库更新 {MACRO_EVENT_CATALOG_UPDATED_AT} · 全库最新{" "}
          {MACRO_EVENT_LATEST_DATE}
        </span>
      </div>
      <div className="macro-event-recent-link">
        <span className="macro-caption">
          年度图表按当前数据年份展示；超出年度窗口的近期事件可在统一工作台查看。
        </span>
        <Button size="sm" variant="ghost" onClick={onRecent}>
          查看近期事件 <ArrowUpRight size={13} />
        </Button>
      </div>
      <nav className="macro-event-filters" aria-label="事件分类">
        {[{ id: "all" as const, name: "全部事件" }, ...MACRO_EVENT_CATEGORIES].map((item) => (
          <Button
            key={item.id}
            size="sm"
            variant="ghost"
            aria-pressed={category === item.id}
            onClick={() => onCategory(item.id)}
          >
            {item.name}
          </Button>
        ))}
      </nav>
      <div className="macro-history-grid">
        <div className="macro-event-list" aria-label="历史关键事件">
          {[...events].reverse().map((event) => (
            <button
              key={event.id}
              type="button"
              className="macro-event-card"
              aria-pressed={selected?.id === event.id}
              onClick={() => onSelect(event)}
            >
              <span className="macro-event-year">{event.start.slice(0, 4)}</span>
              <span className="macro-event-copy">
                <span className="macro-event-meta">
                  <span>
                    {MACRO_EVENT_CATEGORIES.find((item) => item.id === event.category)?.name}
                  </span>
                  <span>
                    {event.countries.length
                      ? event.countries
                          .map(
                            (id) =>
                              snapshot.countries.find((country) => country.id === id)?.name ?? id,
                          )
                          .slice(0, 3)
                          .join(" · ")
                      : "全球"}
                  </span>
                </span>
                <strong>{event.title}</strong>
                <span>{event.summary}</span>
              </span>
              <ArrowUpRight size={17} />
            </button>
          ))}
          {!events.length && (
            <div className="macro-empty">
              <History size={24} />
              <p>当前范围内没有匹配事件。</p>
              <p>可以扩大年份范围或切换事件分类。</p>
            </div>
          )}
        </div>
        <aside className="macro-event-inspector" aria-label="事件观察">
          {selected ? (
            <>
              <span className="macro-eyebrow">EVENT IN FOCUS</span>
              <h3>{selected.title}</h3>
              <p className="macro-event-date">
                <CalendarDays size={14} />
                {eventDateLabel(selected)}
              </p>
              <p>{selected.summary}</p>
              <div className="macro-event-mechanism">
                <strong>观察视角</strong>
                <p>{selected.mechanism}</p>
              </div>
              <div className="macro-event-comparison">
                <strong>事件前后 · 实际 GDP 增速</strong>
                <div className="macro-event-comparison-head">
                  <span>经济体</span>
                  <span>{Number(selected.start.slice(0, 4)) - 1} 年</span>
                  <ArrowRight size={12} />
                  <span>{Number((selected.end ?? selected.start).slice(0, 4)) + 1} 年</span>
                </div>
                {countries.map((id, index) => {
                  const values = getMacroSeries(snapshot, id, "growth"),
                    before =
                      values.find((point) => point.year === Number(selected.start.slice(0, 4)) - 1)
                        ?.value ?? null,
                    after =
                      values.find(
                        (point) =>
                          point.year === Number((selected.end ?? selected.start).slice(0, 4)) + 1,
                      )?.value ?? null;
                  return (
                    <div className="macro-event-comparison-row" key={id}>
                      <span style={{ color: `var(${SERIES_TOKENS[index]})` }}>
                        {snapshot.countries.find((country) => country.id === id)?.name ?? id}
                      </span>
                      <span>{formatMacroValue(before, "growth")}</span>
                      <ArrowRight size={12} />
                      <span>{formatMacroValue(after, "growth")}</span>
                    </div>
                  );
                })}
                <p className="macro-caption">
                  同期变化用于辅助观察，不能单独证明因果关系。缺失值显示为 —。
                </p>
              </div>
              <div className="macro-event-sources">
                <strong>原始资料</strong>
                {selected.sources.map((source) => (
                  <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">
                    {source.title}
                    <ArrowUpRight size={13} />
                  </a>
                ))}
              </div>
              <Button variant="ghost" onClick={() => onSelect(selected)}>
                <Focus size={14} />
                聚焦事件前后
              </Button>
            </>
          ) : (
            <div className="macro-inspector-empty">
              <Focus size={28} />
              <h3>把事件放进时间轴</h3>
              <p>选择左侧事件或图中的菱形标记，查看历史背景、原始资料与前后变化。</p>
              <span>事实有来源，解读有边界。</span>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
