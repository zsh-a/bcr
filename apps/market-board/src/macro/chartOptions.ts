import type { EChartsOption, LineSeriesOption, ScatterSeriesOption } from "echarts";
import { formatMacroValue, getMacroSeries, type MacroSnapshot } from "@bcr/market-data/macro";
import { MACRO_EVENT_CATEGORIES, type MacroEvent } from "@bcr/market-data/macro/events";
import { eventDateLabel, MAX_YEAR, MIN_YEAR, type MacroViewState } from "./state";
import { EVENT_LANE_NAMES, groupChartEvents } from "./chartData";
import {
  baseChartOption,
  createChartTooltip,
  CHART_MONO,
  transparent,
  type ChartPalette,
  type ChartPresentation,
} from "./chartStyle";
import { createPhaseOption } from "./phaseOptions";
export type { ChartPalette } from "./chartStyle";

interface TooltipPoint {
  seriesName: string;
  seriesId: string;
  value: [number, number];
  data?: { eventId?: string; eventIds?: string[] };
}
export function createMacroChartOption(
  snapshot: MacroSnapshot,
  state: MacroViewState,
  events: readonly MacroEvent[],
  palette: ChartPalette,
  reducedMotion: boolean,
  presentation: ChartPresentation = { compact: false, focusedCountry: null },
): EChartsOption {
  if (state.mode === "phase")
    return createPhaseOption(snapshot, state, palette, reducedMotion, presentation);
  const base = baseChartOption(palette, reducedMotion);
  const names = new Map(snapshot.countries.map((country) => [country.id, country.name]));
  const left = presentation.compact ? 54 : 65,
    right = presentation.compact ? 22 : 148;
  const selectedEvent = events.find((event) => event.id === state.event);
  const series: (LineSeriesOption | ScatterSeriesOption)[] = [];
  state.countries.forEach((country, index) => {
    const color = palette.colors[index] ?? palette.text;
    const active = !presentation.focusedCountry || presentation.focusedCountry === country;
    const observations = getMacroSeries(snapshot, country, state.indicator);
    const last = observations
      .filter(
        (point) =>
          point.year >= state.range[0] && point.year <= state.range[1] && point.value !== null,
      )
      .at(-1);
    series.push({
      id: country,
      name: names.get(country) ?? country,
      type: "line",
      data: observations.map((point) => [point.year, point.value]),
      symbol: ["circle", "rect", "triangle", "diamond", "roundRect", "pin"][index] ?? "circle",
      symbolSize: 6,
      showSymbol: false,
      connectNulls: false,
      lineStyle: {
        width: presentation.focusedCountry === country ? 3 : 2,
        color,
        opacity: active ? 0.95 : 0.14,
        cap: "round",
        join: "round",
      },
      itemStyle: { color, opacity: active ? 1 : 0.14 },
      areaStyle:
        presentation.focusedCountry === country
          ? { color: transparent(color, 0.055), origin: 0 }
          : { opacity: 0 },
      emphasis: { focus: "none", lineStyle: { width: 3 } },
      blur: { lineStyle: { opacity: 0.12 } },
      z: presentation.focusedCountry === country ? 4 : 2,
      markLine:
        index === 0
          ? {
              silent: true,
              symbol: "none",
              label: { show: false },
              lineStyle: { color: palette.muted, opacity: 0.35, type: "dashed", width: 1 },
              data: [{ yAxis: 0 }],
            }
          : {},
      markArea:
        index === 0 && selectedEvent
          ? {
              silent: true,
              itemStyle: { color: transparent(palette.colors[0] ?? palette.text, 0.065) },
              data: [
                [
                  { xAxis: Number(selectedEvent.start.slice(0, 4)) },
                  { xAxis: Number((selectedEvent.end ?? selectedEvent.start).slice(0, 4)) + 1 },
                ],
              ],
            }
          : {},
    });
    if (last)
      series.push({
        id: `endpoint:${country}`,
        name: names.get(country) ?? country,
        type: "scatter",
        silent: true,
        data: [[last.year, last.value]],
        symbolSize: 6,
        itemStyle: {
          color,
          borderColor: palette.surface,
          borderWidth: 1.5,
          opacity: active ? 1 : 0.14,
        },
        label: {
          show: !presentation.compact && active,
          position: "right",
          distance: 12,
          formatter: `{name|${names.get(country) ?? country}} {value|${formatMacroValue(last.value, state.indicator)}}\n{year|${last.year}}`,
          backgroundColor: transparent(palette.surface, 0.92),
          padding: [3, 5],
          borderRadius: 3,
          rich: {
            name: { color, fontSize: 11, lineHeight: 17 },
            value: { color: palette.text, fontFamily: CHART_MONO, fontSize: 11, lineHeight: 17 },
            year: { color: palette.muted, fontSize: 10, lineHeight: 14 },
          },
        },
        labelLayout: { moveOverlap: "shiftY", hideOverlap: true },
        labelLine: { show: true, lineStyle: { color, opacity: 0.5 } },
        tooltip: { show: false },
        z: 6,
      });
  });
  const groups = groupChartEvents(events, state.range[0]);
  MACRO_EVENT_CATEGORIES.forEach((category, lane) => {
    const color = palette.colors[lane] ?? palette.text;
    for (const event of events.filter((item) => item.category === category.id && item.end)) {
      series.push({
        id: `events:span:${event.id}`,
        name: category.name,
        type: "line",
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: [
          Math.max(state.range[0], Number(event.start.slice(0, 4))),
          Math.min(state.range[1], Number(event.end!.slice(0, 4))),
        ].map((year) => ({ value: [year, lane], eventId: event.id })),
        symbol: "none",
        lineStyle: { color, width: 3, opacity: 0.3 },
        tooltip: { show: false },
        z: 1,
      });
    }
    series.push({
      id: `events:${category.id}`,
      name: category.name,
      type: "scatter",
      xAxisIndex: 1,
      yAxisIndex: 1,
      clip: false,
      symbol: "diamond",
      data: groups
        .filter((group) => group.lane === lane)
        .map((group) => ({
          value: [group.year, lane],
          eventIds: group.events.map((event) => event.id),
          eventId: group.events[0]?.id,
          name: group.events.map((event) => event.title).join(" / "),
          symbolSize: group.events.some((event) => event.id === state.event)
            ? 20
            : group.events.length > 1
              ? 18
              : 9,
          label: {
            show: group.events.length > 1,
            formatter: String(group.events.length),
            color: palette.surface,
            fontSize: 10,
            fontFamily: CHART_MONO,
            fontWeight: 600,
          },
        })),
      itemStyle: { color, opacity: 0.9, borderColor: palette.surface, borderWidth: 1 },
      emphasis: { scale: 1.25, itemStyle: { opacity: 1 } },
      tooltip: { trigger: "item" },
      z: 4,
    });
  });
  return {
    ...base,
    grid: [
      { left, right, top: 18, height: "53%" },
      { left, right, top: "66%", height: "22%" },
    ],
    axisPointer: {
      link: [{ xAxisIndex: "all" }],
      lineStyle: { color: palette.muted, type: "dashed", width: 1, opacity: 0.55 },
      label: {
        backgroundColor: palette.surface,
        borderColor: palette.border,
        borderWidth: 1,
        color: palette.text,
        fontFamily: CHART_MONO,
        fontSize: 11,
      },
    },
    xAxis: [0, 1].map((index) => ({
      type: "value",
      gridIndex: index,
      min: MIN_YEAR,
      max: MAX_YEAR,
      minInterval: 1,
      splitNumber: presentation.compact ? 3 : 5,
      axisTick: { show: false },
      axisLine: { show: false },
      splitLine: { show: false },
      axisLabel: {
        show: index === 0,
        color: palette.muted,
        fontSize: 11,
        margin: 12,
        formatter: (year: number) => String(Math.round(year)),
      },
      axisPointer: {
        snap: index === 0,
        label: {
          show: index === 0,
          formatter: (params: { value: unknown }) => String(Math.round(Number(params.value))),
        },
      },
    })),
    yAxis: [
      {
        type: "value",
        scale: true,
        axisLine: { show: false },
        axisTick: { show: false },
        splitNumber: 4,
        axisLabel: {
          color: palette.muted,
          fontSize: 11,
          formatter: (value: number) => formatMacroValue(value, state.indicator, true),
        },
        splitLine: { lineStyle: { color: palette.border, opacity: 0.3, type: "dashed" } },
      },
      {
        type: "category",
        data: EVENT_LANE_NAMES,
        gridIndex: 1,
        inverse: true,
        axisLine: { show: false },
        axisTick: { show: false },
        axisPointer: { show: false },
        axisLabel: {
          color: palette.muted,
          fontSize: 10,
          margin: 14,
        },
        splitLine: { show: false },
      },
    ],
    dataZoom: [
      {
        type: "inside",
        xAxisIndex: [0, 1],
        startValue: state.range[0],
        endValue: state.range[1],
        filterMode: "filter",
        zoomOnMouseWheel: "ctrl",
        moveOnMouseWheel: false,
        minValueSpan: 1,
      },
      {
        type: "slider",
        xAxisIndex: [0, 1],
        startValue: state.range[0],
        endValue: state.range[1],
        filterMode: "filter",
        bottom: 5,
        left,
        right,
        height: 18,
        minValueSpan: 1,
        showDetail: false,
        borderColor: transparent(palette.border, 0.7),
        fillerColor: transparent(palette.colors[0] ?? palette.text, 0.08),
        moveHandleStyle: { color: palette.muted, opacity: 0.2 },
        handleStyle: { color: palette.colors[0] ?? palette.text, borderWidth: 0 },
        textStyle: { color: palette.muted },
        dataBackground: {
          lineStyle: { color: palette.muted, opacity: 0.25 },
          areaStyle: { opacity: 0 },
        },
        selectedDataBackground: {
          lineStyle: { color: palette.colors[0] ?? palette.text, opacity: 0.7 },
          areaStyle: { opacity: 0 },
        },
      },
    ],
    tooltip: {
      ...(base.tooltip as object),
      formatter: (raw: unknown) => {
        const points = (Array.isArray(raw) ? raw : [raw]) as TooltipPoint[];
        const ids = points.find(
          (point) => point.data?.eventIds?.length || point.data?.eventId,
        )?.data;
        if (ids) {
          const selected = events.filter((event) =>
            (ids.eventIds ?? [ids.eventId]).includes(event.id),
          );
          return selected.length > 1
            ? createChartTooltip({
                title: `${selected.length} 条历史事件`,
                subtitle: "同年同类",
                rows: selected.map((event) => ({
                  label: event.title,
                  value: eventDateLabel(event),
                })),
                footer: "点击展开事件列表",
              })
            : selected[0]
              ? createChartTooltip({
                  title: selected[0].title,
                  subtitle: eventDateLabel(selected[0]),
                  footer: "点击查看背景与原始资料",
                })
              : "";
        }
        const valid = points.filter((point) => state.countries.includes(point.seriesId));
        return createChartTooltip({
          title: String(Math.round(Number(points[0]?.value?.[0] ?? state.range[1]))),
          subtitle: "年度观测",
          rows: valid.map((point) => ({
            label: point.seriesName,
            value: formatMacroValue(point.value[1], state.indicator),
            color: palette.colors[state.countries.indexOf(point.seriesId)] ?? palette.text,
          })),
        });
      },
    },
    series,
  };
}
