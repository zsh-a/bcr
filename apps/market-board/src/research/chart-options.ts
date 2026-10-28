import type { EChartsOption, LineSeriesOption } from "echarts";
import { baseChartOption, CHART_MONO, transparent, type ChartPalette } from "../macro/chartStyle";
import type { ResearchChartProps } from "./chart-types";
import {
  axisValue,
  chartDomain,
  dateNumber,
  eventBounds,
  eventPeriod,
  visibleEvents,
} from "./interaction";

export function countryColor(
  country: string,
  colors: Record<string, string>,
  palette: ChartPalette,
): string {
  if (colors[country]) return colors[country];
  const hash =
    country.split("").reduce((value, letter) => value * 31 + letter.charCodeAt(0), 0) >>> 0;
  return palette.colors[hash % palette.colors.length] ?? palette.text;
}
export function buildResearchChartOption(
  props: ResearchChartProps,
  palette: ChartPalette,
  compact: boolean,
  reducedMotion: boolean,
): EChartsOption {
  const { tracks, range, baseline } = props,
    height = props.height ?? 150,
    slider = !!props.onRangeChange && height >= 260,
    domain: [number, number] = slider
      ? chartDomain(tracks, range)
      : [dateNumber(range[0]), dateNumber(range[1])],
    events = visibleEvents(props.events, props.event, range),
    units = [...new Set(tracks.map((track) => track.series.unit))],
    mixed = units.length > 1,
    base = baseChartOption(palette, reducedMotion);
  const series: LineSeriesOption[] = tracks.map((track) => {
    const color = countryColor(track.series.country, props.colors, palette);
    return {
      id: track.series.id,
      name: track.series.country,
      type: "line",
      // The chart-only plot already contains omitted native periods as nulls.
      data: mixed
        ? []
        : track.plot.map((point, index) => ({
            value: [dateNumber(point.date), point.value],
            period: point.period,
            date: point.date,
            // A lone valid observation after a gap still needs a visible mark.
            symbolSize:
              point.value !== null &&
              Number.isFinite(point.value) &&
              (track.plot[index - 1]?.value == null ||
                !Number.isFinite(track.plot[index - 1]?.value)) &&
              (track.plot[index + 1]?.value == null ||
                !Number.isFinite(track.plot[index + 1]?.value))
                ? 5
                : 0,
          })),
      connectNulls: false,
      showSymbol: true,
      symbol: "circle",
      symbolSize: 0,
      clip: true,
      lineStyle: { color, width: height >= 260 ? 2 : 1.7, cap: "round", join: "round" },
      itemStyle: { color },
      emphasis: { disabled: true },
      animation: false,
    };
  });
  // A dedicated silent layer preserves baselines/events even for an empty selection.
  series.push({
    id: "research:context",
    type: "line",
    data: [],
    silent: true,
    tooltip: { show: false },
    markLine: {
      silent: true,
      symbol: "none",
      label: { show: false },
      lineStyle: { color: palette.muted, opacity: 0.5, type: "dashed", width: 1 },
      data: [
        ...(baseline !== null && Number.isFinite(baseline) ? [{ yAxis: baseline }] : []),
        ...events
          .filter((event) => event.precision === "day" && !event.end)
          .map((event) => ({
            xAxis: eventBounds(event)[0],
            name: `${event.title} · ${eventPeriod(event)}`,
            lineStyle: {
              color: palette.muted,
              opacity: event.id === props.event?.id ? 0.8 : 0.28,
              type: "dotted" as const,
            },
            label: {
              show: height >= 260 && event.id === props.event?.id,
              formatter: event.title,
              position: "insideEndTop" as const,
              color: palette.muted,
              fontSize: 10,
            },
          })),
      ],
    },
    markArea: {
      silent: true,
      label: { show: false },
      data: events
        .filter((event) => event.precision !== "day" || !!event.end)
        .map((event) => {
          const [start, end] = eventBounds(event),
            selected = event.id === props.event?.id;
          return [
            {
              name: `${event.title} · ${eventPeriod(event)}`,
              xAxis: start,
              itemStyle: {
                color: transparent(palette.muted, selected ? 0.12 : 0.045),
                borderColor: transparent(palette.muted, selected ? 0.3 : 0.1),
                borderWidth: selected ? 1 : 0,
              },
              label: {
                show: selected && height >= 260,
                color: palette.muted,
                fontSize: 10,
                position: "insideTopLeft" as const,
                formatter: `${event.start}${event.end ? `—${event.end}` : ""} · ${event.title}`,
              },
            },
            { xAxis: end },
          ];
        }),
    },
  });
  return {
    ...base,
    useUTC: true,
    animation: false,
    grid: {
      top: height >= 260 ? 24 : 15,
      left: compact ? 46 : 57,
      right: 13,
      bottom: slider ? 57 : 26,
    },
    tooltip: { show: false },
    xAxis: {
      type: "time",
      min: domain[0],
      max: Math.max(domain[0]! + 86_400_000, domain[1]!),
      splitNumber: compact ? 3 : 5,
      axisTick: { show: false },
      axisLine: { show: false },
      splitLine: { show: false },
      axisLabel: {
        color: palette.muted,
        fontFamily: CHART_MONO,
        fontSize: 10,
        hideOverlap: true,
        showMinLabel: true,
        showMaxLabel: true,
        formatter: (value: number) => {
          const date = new Date(value),
            span = dateNumber(range[1]) - dateNumber(range[0]);
          return span < 120 * 86_400_000
            ? `${String(date.getUTCMonth() + 1).padStart(2, "0")}.${String(date.getUTCDate()).padStart(2, "0")}`
            : span > 730 * 86_400_000
              ? String(date.getUTCFullYear())
              : `${String(date.getUTCFullYear()).slice(2)}.${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
        },
      },
      axisPointer: { show: false },
    },
    yAxis: {
      type: "value",
      scale: true,
      ...(baseline !== null && Number.isFinite(baseline)
        ? {
            min: (extent: { min: number; max: number }) => Math.min(extent.min, baseline),
            max: (extent: { min: number; max: number }) => Math.max(extent.max, baseline),
          }
        : {}),
      splitNumber: height < 220 ? 2 : 4,
      name:
        units.length === 1
          ? ((
              {
                index: "指数",
                percent: "%",
                percentagePoints: "百分点",
                percentGdp: "% GDP",
                percentIncome: "% 收入",
                percentRevenue: "% 财政收入",
                usd: "美元",
                persons: "人",
                thousandPersons: "千人",
                thousandUnits: "千套",
                hours: "小时",
                ratio: "倍",
                billionsUsd: "十亿美元",
                trillionLocal: "万亿本币",
                billionLocal: "十亿本币",
              } as Record<string, string>
            )[units[0]!] ?? units[0]!)
          : "",
      nameGap: 7,
      nameLocation: "end",
      nameTextStyle: { color: palette.muted, fontFamily: CHART_MONO, fontSize: 9, align: "right" },
      axisTick: { show: false },
      axisLine: { show: false },
      axisLabel: {
        color: palette.muted,
        fontFamily: CHART_MONO,
        fontSize: 10,
        hideOverlap: true,
        formatter: axisValue,
      },
      splitLine: { lineStyle: { color: palette.border, opacity: 0.45, type: "dashed" } },
      axisPointer: { show: false },
    },
    ...(slider
      ? {
          dataZoom: [
            {
              id: "research:zoom",
              type: "slider",
              xAxisIndex: 0,
              startValue: dateNumber(range[0]),
              endValue: dateNumber(range[1]),
              filterMode: "none",
              bottom: 8,
              left: compact ? 46 : 57,
              right: 13,
              height: 17,
              brushSelect: false,
              showDetail: false,
              throttle: 100,
              borderColor: transparent(palette.border, 0.7),
              backgroundColor: "transparent",
              fillerColor: transparent(palette.muted, 0.1),
              handleSize: "100%",
              handleStyle: { color: palette.muted, borderWidth: 0 },
              moveHandleSize: 0,
              textStyle: { color: palette.muted },
              dataBackground: { lineStyle: { opacity: 0 }, areaStyle: { opacity: 0 } },
              selectedDataBackground: { lineStyle: { opacity: 0 }, areaStyle: { opacity: 0 } },
            },
          ],
        }
      : {}),
    series,
  };
}
