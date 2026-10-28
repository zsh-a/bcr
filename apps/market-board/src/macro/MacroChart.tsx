import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { init, use as useECharts, type EChartsType } from "echarts/core";
import { LineChart, ScatterChart } from "echarts/charts";
import {
  AriaComponent,
  DataZoomComponent,
  GraphicComponent,
  GridComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent,
} from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import { LabelLayout } from "echarts/features";
import type { MacroSnapshot } from "@bcr/market-data/macro";
import type { MacroEvent } from "@bcr/market-data/macro/events";
import { createMacroChartOption, type ChartPalette } from "./chartOptions";
import { MAX_YEAR, MIN_YEAR, SERIES_TOKENS, type MacroViewState } from "./state";
import { groupChartEvents } from "./chartData";

useECharts([
  LineChart,
  ScatterChart,
  GridComponent,
  TooltipComponent,
  DataZoomComponent,
  GraphicComponent,
  LabelLayout,
  MarkAreaComponent,
  MarkLineComponent,
  AriaComponent,
  SVGRenderer,
]);
export function MacroChart({
  snapshot,
  state,
  events,
  onRangeChange,
  onEventsSelect,
  onHoverYear,
  focusedCountry,
}: {
  snapshot: MacroSnapshot;
  state: MacroViewState;
  events: readonly MacroEvent[];
  onRangeChange: (range: [number, number]) => void;
  onEventsSelect: (events: MacroEvent[]) => void;
  onHoverYear: (year: number | null) => void;
  focusedCountry: string | null;
}) {
  const container = useRef<HTMLDivElement>(null);
  const instance = useRef<EChartsType | null>(null);
  const [palette, setPalette] = useState<ChartPalette | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [compact, setCompact] = useState(false);
  const previousMode = useRef<MacroViewState["mode"] | null>(null);
  const selectEvents = useEffectEvent((ids: string[]) => {
    const selected = events.filter((item) => ids.includes(item.id));
    if (selected.length) onEventsSelect(selected);
  });
  const hoverYear = useEffectEvent((value: number | null) =>
    onHoverYear(
      value === null || state.mode !== "trend"
        ? null
        : Math.max(state.range[0], Math.min(state.range[1], Math.round(value))),
    ),
  );
  const changeRange = useEffectEvent((range: [number, number]) => {
    if (range[0] !== state.range[0] || range[1] !== state.range[1]) onRangeChange(range);
  });
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const chart = init(element, undefined, { renderer: "svg" });
    instance.current = chart;
    const updatePalette = () => {
      const style = getComputedStyle(element),
        color = (token: string) => style.getPropertyValue(token).trim();
      setPalette({
        text: color("--color-text"),
        muted: color("--color-faint"),
        border: color("--color-border"),
        surface: color("--color-surface"),
        colors: SERIES_TOKENS.map(color),
      });
    };
    updatePalette();
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => setReducedMotion(media.matches);
    updateMotion();
    media.addEventListener("change", updateMotion);
    const theme = new MutationObserver(updatePalette);
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "class"],
    });
    setCompact(element.clientWidth < 580);
    const resize = new ResizeObserver(() => {
      chart.resize();
      setCompact(element.clientWidth < 580);
    });
    resize.observe(element);
    chart.on("click", (params) => {
      const data = params.data as { eventId?: string; eventIds?: string[] } | undefined;
      if (data?.eventIds?.length) selectEvents(data.eventIds);
      else if (data?.eventId) selectEvents([data.eventId]);
    });
    chart.on("updateAxisPointer", (raw: unknown) => {
      const axis = (
        raw as { axesInfo?: { axisDim: string; axisIndex: number; value: number }[] }
      ).axesInfo?.find((item) => item.axisDim === "x" && item.axisIndex === 0);
      if (axis && Number.isFinite(Number(axis.value))) hoverYear(Number(axis.value));
    });
    chart.getZr().on("globalout", () => hoverYear(null));
    let timer: ReturnType<typeof setTimeout> | undefined;
    chart.on("datazoom", (raw: unknown) => {
      const zoom = raw as {
          start?: number;
          end?: number;
          batch?: { start?: number; end?: number }[];
        },
        value = zoom.batch?.[0] ?? zoom;
      if (value.start === undefined || value.end === undefined) return;
      const from = Math.round(MIN_YEAR + ((MAX_YEAR - MIN_YEAR) * value.start) / 100),
        to = Math.round(MIN_YEAR + ((MAX_YEAR - MIN_YEAR) * value.end) / 100);
      clearTimeout(timer);
      timer = setTimeout(() => changeRange([Math.min(from, to - 1), to]), 120);
    });
    return () => {
      clearTimeout(timer);
      theme.disconnect();
      resize.disconnect();
      media.removeEventListener("change", updateMotion);
      chart.dispose();
      instance.current = null;
    };
  }, []);
  const option = useMemo(
    () =>
      palette
        ? createMacroChartOption(snapshot, state, events, palette, reducedMotion, {
            compact,
            focusedCountry,
          })
        : null,
    [snapshot, state, events, palette, reducedMotion, compact, focusedCountry],
  );
  useEffect(() => {
    if (option) {
      const reset = previousMode.current !== state.mode;
      instance.current?.setOption(option, {
        notMerge: reset,
        replaceMerge: reset ? [] : ["series"],
      });
      previousMode.current = state.mode;
    }
  }, [option, state.mode]);
  return (
    <div
      ref={container}
      className="macro-chart"
      role="img"
      aria-label={
        state.mode === "trend"
          ? `宏观指标与历史事件联动图，${state.range[0]} 至 ${state.range[1]} 年。可通过年份控件和事件列表操作，明细数据可在数据表中阅读。`
          : `${state.year} 年各国实际 GDP 增速与 CPI 通胀率相位图。`
      }
      data-ready={Boolean(option)}
      data-mode={state.mode}
      data-event-count={events.length}
      data-marker-count={groupChartEvents(events, state.range[0]).length}
      data-focused-country={focusedCountry ?? ""}
    />
  );
}
