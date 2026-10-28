import { useState } from "react";
import { CalendarDays, X } from "lucide-react";
import { Button } from "@bcr/react";
import { MACRO_EVENT_CATALOG_UPDATED_AT, type MacroEvent } from "@bcr/market-data/macro/events";
import { eventBounds } from "./presentation";
import { selectRailEvents, type EventRailScope } from "./event-selection";

export function EventRail({
  events,
  selected,
  range,
  onSelect,
  onClear,
}: {
  events: readonly MacroEvent[];
  selected?: MacroEvent | undefined;
  range: [string, string];
  onSelect: (event: MacroEvent) => void;
  onClear: () => void;
}) {
  const [scope, setScope] = useState<EventRailScope>("window");
  const visible = selectRailEvents(events, range, scope, MACRO_EVENT_CATALOG_UPDATED_AT);
  const latest = events.reduce((date, event) => (event.start > date ? event.start : date), "");
  return (
    <section className="research-events" aria-label="共享历史事件轨道">
      <header>
        <h2>
          <CalendarDays size={15} />
          历史事件
        </h2>
        <span>选择事件，同步所有面板的观察窗口</span>
      </header>
      <div className="research-event-coverage">
        <span>精选事件库 · 非实时新闻</span>
        <span>库更新 {MACRO_EVENT_CATALOG_UPDATED_AT}</span>
        <span>所选国家最新收录 {latest || "—"}</span>
      </div>
      <nav className="research-event-scope" aria-label="历史事件展示范围">
        {(
          [
            ["window", "当前窗口"],
            ["recent", "近两年"],
            ["all", "全部收录"],
          ] as const
        ).map(([id, label]) => (
          <Button
            key={id}
            size="sm"
            variant="ghost"
            aria-pressed={scope === id}
            onClick={() => setScope(id)}
          >
            {label}
          </Button>
        ))}
        <span>
          {visible.length}/{events.length} 条 · 新近事件在前 · 保留国家筛选
        </span>
      </nav>
      <div className="research-event-rail">
        {visible.map((event) => {
          const [start, end] = eventBounds(event),
            outside = start > range[1] || end < range[0];
          return (
            <button
              type="button"
              key={event.id}
              aria-pressed={selected?.id === event.id}
              onClick={() => onSelect(event)}
            >
              <small>
                {event.start}
                {event.end ? ` — ${event.end}` : ""}
              </small>
              <strong>{event.title}</strong>
              {outside && <span className="research-event-outside">窗口外 · 点击定位</span>}
            </button>
          );
        })}
      </div>
      {!visible.length && (
        <p className="research-caption">
          当前范围暂无收录事件。可切换“近两年”或“全部收录”；国家筛选仍然生效。
        </p>
      )}
      {selected && (
        <article className="research-event-detail">
          <header>
            <strong>{selected.title}</strong>
            <Button size="sm" variant="ghost" onClick={onClear}>
              <X size={12} />
              清除事件高亮
            </Button>
          </header>
          <p>{selected.summary}</p>
          <p>{selected.mechanism}</p>
          <div>
            {selected.sources.map((source) => (
              <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">
                {source.title} ↗
              </a>
            ))}
          </div>
        </article>
      )}
    </section>
  );
}
