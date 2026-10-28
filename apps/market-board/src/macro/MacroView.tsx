import { useEffect, useMemo, useState, useTransition } from "react";
import {
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  CircleHelp,
  Database,
  Globe2,
  LayoutList,
  Link2,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
} from "lucide-react";
import {
  Button,
  Dialog,
  Select,
  Spinner,
  useLocationSearch,
  useNavigation,
  useRuntimeActivity,
} from "@bcr/react";
import { bundledMacroSnapshot, getMacroSeries, MACRO_INDICATORS } from "@bcr/market-data/macro";
import {
  filterMacroEvents,
  MACRO_EVENTS,
  MACRO_EVENT_CATALOG_UPDATED_AT,
  type MacroEvent,
} from "@bcr/market-data/macro/events";
import { CountryRail } from "./CountryRail";
import { CountryCards } from "./CountryCards";
import { DataDialogs } from "./DataDialogs";
import { EventPanels } from "./EventPanels";
import { MacroChart } from "./MacroChart";
import {
  eventFocusRange,
  macroCsv,
  macroStateUrl,
  MAX_YEAR,
  MIN_YEAR,
  parseMacroState,
  type MacroViewState,
} from "./state";
import { useMacroData } from "./useMacroData";
import { ChartLegend } from "./ChartLegend";
import { EventClusterDialog } from "./EventClusterDialog";
import "@fontsource-variable/newsreader";
import "./styles.css";

const years = Array.from({ length: MAX_YEAR - MIN_YEAR + 1 }, (_, index) => MIN_YEAR + index);
export default function MacroView() {
  const navigation = useNavigation(),
    search = useLocationSearch(),
    active = useRuntimeActivity();
  const state = useMemo(() => parseMacroState(search, bundledMacroSnapshot.countries), [search]);
  const { snapshot, refreshing, refresh, status, error } = useMacroData(state.countries);
  const [pending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<"sources" | "table" | null>(null);
  const [countryDialog, setCountryDialog] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);
  const [focusedCountry, setFocusedCountry] = useState<string | null>(null);
  const [hoverYear, setHoverYear] = useState<number | null>(null);
  const [clusterEvents, setClusterEvents] = useState<MacroEvent[]>([]);
  useEffect(() => setClusterEvents([]), [search]);
  useEffect(() => {
    setHoverYear(null);
    if (focusedCountry && !state.countries.includes(focusedCountry)) setFocusedCountry(null);
  }, [search, focusedCountry]);
  const update = (patch: Partial<MacroViewState>, replace = false) =>
    startTransition(() =>
      navigation.navigate(macroStateUrl({ ...state, ...patch }, search), replace),
    );
  const events = useMemo(
    () => filterMacroEvents(MACRO_EVENTS, state.countries, state.range, state.category),
    [state.countries, state.range, state.category],
  );
  const selectedEvent = events.find((event) => event.id === state.event);
  const indicator =
    MACRO_INDICATORS.find((item) => item.id === state.indicator) ?? MACRO_INDICATORS[0]!;
  const sourceDates = [
    ...new Set(
      snapshot.series
        .filter(
          (series) =>
            state.countries.includes(series.country) && series.indicator === state.indicator,
        )
        .map((series) => series.sourceUpdatedAt ?? snapshot.sourceUpdatedAt),
    ),
  ].sort();
  const sourceDateLabel =
    sourceDates.length > 1
      ? `${sourceDates[0]} — ${sourceDates.at(-1)}`
      : (sourceDates[0] ?? snapshot.sourceUpdatedAt);
  const selectEvent = (event: MacroEvent) => {
    setPlaying(false);
    update({ event: event.id, range: eventFocusRange(event), mode: "trend" });
  };
  useEffect(() => {
    if (!active) {
      setPlaying(false);
      setDialog(null);
      setCountryDialog(false);
      setClusterEvents([]);
    }
  }, [active]);
  useEffect(() => {
    if (!playing || !active || state.mode !== "phase") return;
    const timer = window.setTimeout(() => {
      if (document.visibilityState !== "visible") {
        setPlaying(false);
        return;
      }
      if (state.year >= state.range[1]) {
        setPlaying(false);
        return;
      }
      navigation.navigate(
        macroStateUrl({ ...state, year: Math.max(state.range[0], state.year + 1) }, search),
        true,
      );
    }, 1100);
    return () => window.clearTimeout(timer);
  }, [playing, active, state, navigation, search]);
  useEffect(() => {
    if (!notice && !copied) return;
    const timer = window.setTimeout(() => {
      setNotice("");
      setCopied(false);
    }, 3500);
    return () => window.clearTimeout(timer);
  }, [notice, copied]);
  const exportCsv = () => {
    const url = URL.createObjectURL(
      new Blob([macroCsv(snapshot, state)], { type: "text/csv;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `macro-${state.indicator}-${state.range.join("-")}.csv`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice("CSV 已导出，包含原始精度数值与来源日期。");
  };
  const share = async () => {
    try {
      await navigator.clipboard.writeText(
        new URL(macroStateUrl(state, search), window.location.origin).href,
      );
      setCopied(true);
    } catch {
      setNotice("当前浏览器无法复制，请直接复制地址栏中的链接。");
    }
  };
  const missingPhase = state.countries.filter((country) =>
    ["growth", "inflation"].some(
      (id) =>
        getMacroSeries(snapshot, country, id as "growth" | "inflation").find(
          (point) => point.year === state.year,
        )?.value == null,
    ),
  );
  return (
    <div
      className="macro-atlas"
      data-range={state.range.join("-")}
      data-indicator={state.indicator}
      aria-busy={pending}
    >
      <aside className="macro-sidebar">
        <div className="macro-rail-brand">
          <Globe2 size={20} />
          <span>
            MACRO ATLAS<small>全球经济 · 历史坐标</small>
          </span>
        </div>
        <CountryRail
          countries={snapshot.countries}
          selected={state.countries}
          onChange={(countries) => update({ countries, event: null })}
        />
        <div className="macro-rail-foot">
          <Database size={16} />
          <p>
            数据已随项目打包<small>世界银行 WDI · 无需等待联网</small>
          </p>
        </div>
      </aside>
      <div className="macro-main">
        <header className="macro-page-heading">
          <div>
            <span className="macro-eyebrow">THE WORLD, IN CONTEXT</span>
            <h1>
              全球宏观观察<span>Macro Atlas</span>
            </h1>
            <p>沿着经济的曲线，读懂历史的转折。</p>
          </div>
          <div className="macro-page-actions">
            <Button className="macro-country-trigger" onClick={() => setCountryDialog(true)}>
              <SlidersHorizontal size={15} />
              选择经济体
            </Button>
            <Button variant="ghost" onClick={() => setDialog("sources")}>
              <CircleHelp size={16} />
              数据说明
            </Button>
            <Button variant="ghost" onClick={() => void share()} aria-label="复制当前看板链接">
              {copied ? <Check size={16} /> : <Link2 size={16} />}
            </Button>
            <Button onClick={exportCsv}>
              <ArrowDownToLine size={15} />
              导出 CSV
            </Button>
          </div>
        </header>
        <div className="macro-data-status">
          <span>
            <span className="macro-status-dot" />
            {status}
          </span>
          <span>所选指标来源更新 {sourceDateLabel}</span>
          <Button variant="ghost" size="sm" onClick={() => void refresh()} disabled={refreshing}>
            {refreshing ? <Spinner size="sm" /> : <RefreshCw size={13} />}
            {refreshing ? "正在更新所选经济体" : "手动更新"}
          </Button>
        </div>
        {error && (
          <p className="macro-notice" role="status">
            {error}
          </p>
        )}
        <nav className="macro-indicators" aria-label="宏观经济指标">
          {MACRO_INDICATORS.map((item) => (
            <Button
              key={item.id}
              variant="ghost"
              aria-pressed={state.indicator === item.id}
              onClick={() => update({ indicator: item.id, mode: "trend" })}
            >
              {item.shortName}
            </Button>
          ))}
        </nav>
        <CountryCards
          snapshot={snapshot}
          countries={state.countries}
          indicator={state.indicator}
          beforeYear={state.range[1]}
        />
        <section className="macro-chart-panel" aria-label="宏观可视化研究">
          <div className="macro-chart-heading">
            <div>
              <span className="macro-eyebrow">
                {state.mode === "trend" ? "ECONOMIC TRAJECTORIES" : "GROWTH × INFLATION"}
              </span>
              <h2>
                {state.mode === "trend" ? indicator.name : "增长与通胀的交汇"}
                <span>
                  {state.mode === "trend"
                    ? indicator.unit === "usd"
                      ? "现价美元 · 年度"
                      : "% · 年度"
                    : `${state.year} 年`}
                </span>
              </h2>
            </div>
            <div className="macro-view-switch" aria-label="可视化方式">
              <Button
                size="sm"
                variant="ghost"
                aria-pressed={state.mode === "trend"}
                onClick={() => {
                  setPlaying(false);
                  update({ mode: "trend" });
                }}
              >
                趋势对比
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-pressed={state.mode === "phase"}
                onClick={() =>
                  update({
                    mode: "phase",
                    year: Math.max(state.range[0], Math.min(state.range[1], state.year)),
                  })
                }
              >
                增长 × 通胀
              </Button>
            </div>
          </div>
          <div className="macro-chart-toolbar">
            <ChartLegend
              snapshot={snapshot}
              state={state}
              focusedCountry={focusedCountry}
              hoverYear={hoverYear}
              onFocus={setFocusedCountry}
            />
            <div className="macro-range-controls">
              <Select
                aria-label="起始年份"
                value={state.range[0]}
                onChange={(event) => {
                  setPlaying(false);
                  update({ range: [Number(event.target.value), state.range[1]], event: null });
                }}
              >
                {years
                  .filter((year) => year < state.range[1])
                  .map((year) => (
                    <option key={year}>{year}</option>
                  ))}
              </Select>
              <span>—</span>
              <Select
                aria-label="结束年份"
                value={state.range[1]}
                onChange={(event) => {
                  setPlaying(false);
                  update({ range: [state.range[0], Number(event.target.value)], event: null });
                }}
              >
                {years
                  .filter((year) => year > state.range[0])
                  .map((year) => (
                    <option key={year}>{year}</option>
                  ))}
              </Select>
              <Button
                variant="ghost"
                size="sm"
                aria-label="重置时间范围"
                onClick={() => {
                  setPlaying(false);
                  update({ range: [MIN_YEAR, MAX_YEAR], event: null });
                }}
              >
                <RotateCcw size={13} />
              </Button>
            </div>
          </div>
          <MacroChart
            snapshot={snapshot}
            state={state}
            events={events}
            onRangeChange={(range) => update({ range, event: null }, true)}
            onEventsSelect={(selected) => {
              if (selected.length === 1 && selected[0]) selectEvent(selected[0]);
              else setClusterEvents(selected);
            }}
            focusedCountry={focusedCountry}
            onHoverYear={setHoverYear}
          />
          {state.mode === "phase" ? (
            <div className="macro-playback">
              <Button
                variant="ghost"
                aria-label={playing ? "暂停历史播放" : "播放历史轨迹"}
                onClick={() => {
                  if (!playing && state.year >= state.range[1])
                    update({ year: state.range[0] }, true);
                  setPlaying(!playing);
                }}
              >
                {playing ? <Pause size={16} /> : <Play size={16} />}
              </Button>
              <label htmlFor="macro-year">{state.year}</label>
              <input
                id="macro-year"
                type="range"
                aria-label="相位图年份"
                min={state.range[0]}
                max={state.range[1]}
                value={Math.max(state.range[0], Math.min(state.range[1], state.year))}
                onChange={(event) => {
                  setPlaying(false);
                  update({ year: Number(event.target.value) }, true);
                }}
              />
              <span>圆点大小示意名义 GDP；渐隐轨迹为前 5 年，空心圆表示 GDP 缺失。</span>
            </div>
          ) : (
            <div className="macro-chart-foot">
              <span>
                <span className="macro-event-symbol">◇</span>分类事件轨道 · 数字表示同年事件数
              </span>
              <span>拖动底部滑块缩放 · Ctrl + 滚轮缩放</span>
            </div>
          )}
          {state.mode === "phase" && missingPhase.length > 0 && (
            <p className="macro-missing-note">
              {missingPhase
                .map((id) => snapshot.countries.find((country) => country.id === id)?.name)
                .join("、")}
              缺少 {state.year} 年增长或通胀数据，未绘制圆点。
            </p>
          )}
          <footer className="macro-chart-source">
            <span>
              {state.mode === "trend"
                ? indicator.description
                : "两个坐标均为年度变化率；相位图展示同期关系。"}
            </span>
            <Button variant="ghost" size="sm" onClick={() => setDialog("table")}>
              <LayoutList size={14} />
              查看数据表
            </Button>
          </footer>
        </section>
        <EventPanels
          snapshot={snapshot}
          events={events}
          countries={state.countries}
          selected={selectedEvent}
          category={state.category}
          onCategory={(category) => update({ category, event: null })}
          onSelect={selectEvent}
          onRecent={() => {
            const params = new URLSearchParams(search);
            params.set("layer", "research");
            params.set(
              "rFrom",
              `${Number(MACRO_EVENT_CATALOG_UPDATED_AT.slice(0, 4)) - 2}${MACRO_EVENT_CATALOG_UPDATED_AT.slice(4)}`,
            );
            params.set("rTo", MACRO_EVENT_CATALOG_UPDATED_AT);
            params.set("rDate", MACRO_EVENT_CATALOG_UPDATED_AT);
            params.set("rAsOf", "latest");
            params.delete("rEvent");
            params.delete("event");
            navigation.navigate(`/markets?${params}`);
          }}
        />
        <footer className="macro-page-footer">
          <span>WORLD BANK WDI · {snapshot.countries.length} ECONOMIES · 1980—2025</span>
          <a href="https://data.worldbank.org/" target="_blank" rel="noopener noreferrer">
            探索原始数据
            <ArrowUpRight size={12} />
          </a>
        </footer>
      </div>
      <Dialog
        open={active && countryDialog}
        onClose={() => setCountryDialog(false)}
        title="选择比较经济体"
        className="macro-country-dialog"
      >
        <CountryRail
          countries={snapshot.countries}
          selected={state.countries}
          onChange={(countries) => update({ countries, event: null })}
        />
        <Button variant="primary" onClick={() => setCountryDialog(false)}>
          完成选择
        </Button>
      </Dialog>
      <DataDialogs
        snapshot={snapshot}
        state={state}
        dialog={dialog}
        onClose={() => setDialog(null)}
      />
      <EventClusterDialog
        events={active ? clusterEvents : []}
        onClose={() => setClusterEvents([])}
        onSelect={selectEvent}
      />
      {notice && (
        <div className="macro-toast" role="status">
          {notice}
        </div>
      )}
    </div>
  );
}
