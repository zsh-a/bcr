import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { Bookmark, History, X } from "lucide-react";
import { Button, useLocationSearch, useNavigation, useRuntimeActivity } from "@bcr/react";
import {
  bundledEconomicRepository,
  economicCsv,
  queryEconomicTracks,
  type EconomicTrack,
} from "@bcr/market-data/economy";
import { MACRO_EVENTS, type MacroEvent } from "@bcr/market-data/macro/events";
import { parseResearchState, researchCutoff, researchStateUrl, type ResearchState } from "./state";
import { RESEARCH_PRESETS, researchMetrics } from "./presets";
import { countryColorSlot, downloadResearchCsv, eventWindow } from "./presentation";
import { useResearchPalette } from "./useResearchPalette";
import { useSavedResearch } from "./useSavedResearch";
import { useEconomicRepository } from "./useEconomicRepository";
import { ResearchToolbar } from "./ResearchToolbar";
import { ResearchMatrix } from "./ResearchMatrix";
import { MetricPanel } from "./MetricPanel";
import { MetricLibrary } from "./MetricLibrary";
import { ResearchDetail } from "./ResearchDetail";
import { EventRail } from "./EventRail";
import "@fontsource-variable/newsreader";
import "./styles.css";
import "./panels.css";
import "./drawers.css";

const context = {
  countryIds: bundledEconomicRepository.countries.map((country) => country.id),
  metricIds: bundledEconomicRepository.metrics.map((metric) => metric.id),
  minDate: bundledEconomicRepository.minDate,
  maxDate: bundledEconomicRepository.maxDate,
};
/** Currency amounts retain a single economic unit throughout chart, table and CSV. */
function comparable(tracks: EconomicTrack[], focus: string | null) {
  const currencies = new Set(tracks.map((track) => track.series.currency).filter(Boolean));
  return currencies.size > 1
    ? tracks.filter((track) => track.series.country === (focus ?? tracks[0]?.series.country))
    : tracks;
}
export default function ResearchView() {
  const search = useLocationSearch(),
    navigation = useNavigation(),
    active = useRuntimeActivity();
  const state = useMemo(() => parseResearchState(search, context), [search]);
  const repository = useEconomicRepository(state.countries);
  const [pending, startTransition] = useTransition();
  const [library, setLibrary] = useState(false),
    [inspected, setInspected] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null),
    [locked, setLocked] = useState<string | null>(null);
  const [notice, setNotice] = useState(""),
    [copied, setCopied] = useState(false);
  const palette = useResearchPalette(),
    layout = useSavedResearch();
  const countryKey = state.countries.join(","),
    cutoff = researchCutoff(state, repository.maxDate);
  const range = useMemo<[string, string]>(
    () => [state.from < cutoff ? state.from : cutoff, cutoff],
    [state.from, cutoff],
  );
  const cursor = locked ?? hover;
  const metrics = useMemo(() => researchMetrics(repository, state), [state]);
  const metricKey = metrics.map((metric) => metric.id).join(",");
  const colors = useMemo(
    () =>
      Object.fromEntries(
        state.countries.map((id) => [
          id,
          palette.colors[countryColorSlot(id, palette.colors.length)] ?? palette.text,
        ]),
      ),
    [countryKey, palette],
  );
  const tracks = useMemo(
    () =>
      new Map(
        metricKey
          .split(",")
          .filter(Boolean)
          .map((metricId) => [
            metricId,
            comparable(
              queryEconomicTracks(repository, {
                metricId,
                countries: countryKey.split(",").filter(Boolean),
                range,
                cutoff,
              }),
              state.focus,
            ),
          ]),
      ),
    [metricKey, countryKey, range, cutoff, state.focus],
  );
  const detailMetric = repository.metrics.find((metric) => metric.id === inspected) ?? null;
  const detailTracks = useMemo(
    () =>
      inspected
        ? comparable(
            queryEconomicTracks(repository, {
              metricId: inspected,
              countries: countryKey.split(",").filter(Boolean),
              range,
              cutoff,
            }),
            state.focus,
          )
        : [],
    [inspected, countryKey, range, cutoff, state.focus],
  );
  const events = useMemo(
    () =>
      MACRO_EVENTS.filter(
        (event) =>
          !event.countries.length ||
          event.countries.some((country) => state.countries.includes(country)),
      ),
    [countryKey],
  );
  const selectedEvent = events.find((event) => event.id === state.event);
  const update = useCallback(
    (patch: Partial<ResearchState>, replace = false) => {
      const next = { ...state, ...patch };
      const normalized = parseResearchState(
        new URL(researchStateUrl(next, search), location.origin).search,
        context,
      );
      startTransition(() => navigation.navigate(researchStateUrl(normalized, search), replace));
      setHover(null);
      setLocked(null);
    },
    [state, search, navigation],
  );
  const focus = useCallback((country: string) => update({ focus: country }, true), [update]);
  const onCursor = useCallback((date: string | null) => setHover(date), []);
  const inspect = (metric: string) => {
    setLibrary(false);
    setInspected(metric);
  };
  const pin = (metric: string) => {
    if (!state.pins.includes(metric) && state.pins.length >= 8) {
      setNotice("最多钉选 8 项指标，可先取消其他钉选。");
      return;
    }
    update({
      pins: state.pins.includes(metric)
        ? state.pins.filter((id) => id !== metric)
        : [...state.pins, metric],
    });
  };
  const chooseEvent = (event: MacroEvent) => {
    const [from, to] = eventWindow(event, repository.minDate, repository.maxDate);
    update({ event: event.id, from, to, date: to, asOf: "date" });
  };
  const share = async () => {
    try {
      await navigator.clipboard.writeText(
        new URL(researchStateUrl(state, search), location.origin).href,
      );
      setCopied(true);
    } catch {
      setNotice("可直接复制地址栏链接，研究条件已包含在链接中。");
    }
  };
  useEffect(() => {
    if (!notice && !copied) return;
    const timer = window.setTimeout(() => {
      setNotice("");
      setCopied(false);
    }, 3500);
    return () => clearTimeout(timer);
  }, [notice, copied]);
  useEffect(() => {
    if (!active) {
      setLibrary(false);
      setInspected(null);
      setHover(null);
      setLocked(null);
    }
  }, [active]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setLocked(null);
        setHover(null);
      }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, []);
  return (
    <div
      className="research-workbench"
      aria-busy={pending}
      data-preset={state.preset}
      data-cutoff={cutoff}
      data-cursor={cursor ?? ""}
    >
      <ResearchToolbar
        repository={repository}
        state={state}
        cutoff={cutoff}
        onUpdate={update}
        onExport={() =>
          downloadResearchCsv(
            economicCsv([...tracks.values()].flat()),
            `economic-workbench-${cutoff}.csv`,
          )
        }
        onLibrary={() => setLibrary(true)}
        onShare={() => void share()}
        copied={copied}
      />
      {state.countries.length ? (
        <>
          <div className="research-section-head">
            <div>
              <h2>
                {RESEARCH_PRESETS.find((preset) => preset.id === state.preset)?.name}
                <small>
                  {metrics.length} 个联动面板
                  {state.pins.length ? ` · ${state.pins.length} 项跨主题钉选` : ""}
                </small>
              </h2>
              <p>{RESEARCH_PRESETS.find((preset) => preset.id === state.preset)?.hint}</p>
            </div>
            <div className="research-layout-actions">
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  setNotice(
                    layout.save(researchStateUrl(state, search))
                      ? "研究布局已保存到本机。"
                      : "本机存储不可用，可复制链接保存研究条件。",
                  )
                }
              >
                <Bookmark size={13} />
                保存布局
              </Button>
              {layout.saved && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    const restored = parseResearchState(
                      new URL(layout.saved!, location.origin).search,
                      context,
                    );
                    navigation.navigate(researchStateUrl(restored));
                  }}
                >
                  <History size={13} />
                  恢复布局
                </Button>
              )}
            </div>
          </div>
          <div className="research-country-legend" aria-label="研究国家图例">
            {state.countries.map((id) => (
              <button
                type="button"
                key={id}
                aria-pressed={state.focus === id}
                onClick={() => focus(id)}
              >
                <i style={{ background: colors[id] }} />
                {repository.countries.find((country) => country.id === id)?.name ?? id}
              </button>
            ))}
          </div>
          <div className="research-cursor-bar">
            <span aria-live="off">
              {cursor ? `联动读数 ${cursor}` : `窗口内最新 · 截止 ${cutoff}`}
            </span>
            <label>
              固定参考日
              <input
                type="date"
                aria-label="固定联动参考日期"
                min={range[0]}
                max={range[1]}
                value={locked ?? ""}
                onChange={(event) => setLocked(event.target.value || null)}
              />
            </label>
            {cursor && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setLocked(null);
                  setHover(null);
                }}
              >
                <X size={12} />
                读取最新
              </Button>
            )}
            <small>悬停或键盘联动 · 保留各序列实际期次</small>
          </div>
          <div className="research-panel-grid">
            {metrics.map((metric) => (
              <MetricPanel
                key={metric.id}
                repository={repository}
                metric={metric}
                tracks={tracks.get(metric.id) ?? []}
                focus={state.focus}
                range={range}
                colors={colors}
                cursor={cursor}
                onCursor={onCursor}
                pinned={state.pins.includes(metric.id)}
                onPin={() => pin(metric.id)}
                onInspect={() => inspect(metric.id)}
                event={selectedEvent}
                events={events}
                totalCountries={state.countries.length}
                lockedDate={locked}
                onLock={setLocked}
              />
            ))}
          </div>
          <ResearchMatrix
            repository={repository}
            state={state}
            range={range}
            cutoff={cutoff}
            cursor={cursor}
            colors={colors}
            onFocus={focus}
            onInspect={inspect}
          />
          <EventRail
            events={events}
            selected={selectedEvent}
            range={range}
            onSelect={chooseEvent}
            onClear={() => update({ event: null })}
          />
        </>
      ) : (
        <p className="research-empty">请选择至少一个经济体，开始比较增长、物价、就业和金融条件。</p>
      )}
      <footer className="research-footer">
        <span>WORLD BANK · OECD · BIS · NBS · US OFFICIAL STATISTICS</span>
        <span>
          历史值可能修订；观察截止按参考期，不代表当时已公布信息。BIS 中文说明为非官方译释。
        </span>
      </footer>
      <MetricLibrary
        open={library && active}
        onClose={() => setLibrary(false)}
        repository={repository}
        countries={state.countries}
        pins={state.pins}
        onPin={pin}
        onInspect={inspect}
      />
      <ResearchDetail
        key={inspected}
        metric={detailMetric}
        repository={repository}
        tracks={detailTracks}
        range={range}
        cutoff={cutoff}
        colors={colors}
        countries={state.countries}
        focus={state.focus}
        cursor={cursor}
        onCursor={onCursor}
        onRange={(value) => update({ from: value[0], to: value[1] }, true)}
        onFocus={focus}
        pinned={state.pins.includes(inspected ?? "")}
        onPin={() => {
          if (inspected) pin(inspected);
        }}
        onClose={() => setInspected(null)}
        event={selectedEvent}
        events={events}
        active={active}
        lockedDate={locked}
        onLock={setLocked}
      />
      {notice && (
        <div className="research-toast" role="status">
          {notice}
        </div>
      )}
    </div>
  );
}
