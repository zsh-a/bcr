import type { EChartsOption, LineSeriesOption, ScatterSeriesOption } from "echarts";
import { formatMacroValue, type MacroSnapshot } from "@bcr/market-data/macro";
import { phaseBounds, phaseObservation } from "./chartData";
import {
  baseChartOption,
  createChartTooltip,
  transparent,
  type ChartPalette,
  type ChartPresentation,
} from "./chartStyle";
import type { MacroViewState } from "./state";

export function createPhaseOption(
  snapshot: MacroSnapshot,
  state: MacroViewState,
  palette: ChartPalette,
  reducedMotion: boolean,
  presentation: ChartPresentation,
): EChartsOption {
  const bounds = phaseBounds(snapshot, state);
  const base = baseChartOption(palette, reducedMotion);
  const names = new Map(snapshot.countries.map((country) => [country.id, country.name]));
  const series: (LineSeriesOption | ScatterSeriesOption)[] = [];
  state.countries.forEach((country, index) => {
    const color = palette.colors[index] ?? palette.text;
    const active = !presentation.focusedCountry || presentation.focusedCountry === country;
    const trailStart = Math.max(state.range[0], state.year - 5);
    for (let year = trailStart; year < state.year; year += 1) {
      const first = [
        phaseObservation(snapshot, country, "growth", year),
        phaseObservation(snapshot, country, "inflation", year),
      ];
      const second = [
        phaseObservation(snapshot, country, "growth", year + 1),
        phaseObservation(snapshot, country, "inflation", year + 1),
      ];
      if ([...first, ...second].some((value) => value === null)) continue;
      series.push({
        id: `trail:${country}:${year}`,
        type: "line",
        data: [first, second],
        symbol: "circle",
        symbolSize: 3,
        connectNulls: false,
        lineStyle: {
          color,
          width: 1.6,
          opacity: active ? 0.08 + (year - trailStart + 1) * 0.07 : 0.04,
        },
        itemStyle: { color, opacity: active ? 0.35 : 0.04 },
        silent: true,
        tooltip: { show: false },
        z: 1,
      });
    }
    const growth = phaseObservation(snapshot, country, "growth", state.year),
      inflation = phaseObservation(snapshot, country, "inflation", state.year),
      gdp = phaseObservation(snapshot, country, "gdp", state.year);
    series.push({
      name: names.get(country) ?? country,
      type: "scatter",
      id: country,
      data: growth === null || inflation === null ? [] : [[growth, inflation]],
      symbolSize: gdp === null ? 16 : Math.max(18, Math.min(56, 14 + Math.sqrt(gdp / 1e12) * 7)),
      itemStyle: {
        color: gdp === null ? palette.surface : transparent(color, 0.75),
        borderColor: color,
        borderWidth: 1.5,
        opacity: active ? 1 : 0.16,
      },
      label: {
        show: active,
        formatter: names.get(country) ?? country,
        position: "top",
        distance: 9,
        color: palette.text,
        fontSize: 12,
        backgroundColor: transparent(palette.surface, 0.9),
        padding: [3, 5],
        borderRadius: 3,
      },
      labelLayout: { hideOverlap: true, moveOverlap: "shiftY" },
      labelLine: { show: true, lineStyle: { color, opacity: 0.5 }, length2: 8 },
      emphasis: { scale: 1.12, itemStyle: { opacity: 1, borderWidth: 2 } },
      z: active ? 4 : 2,
      markLine:
        index === 0
          ? {
              silent: true,
              symbol: "none",
              label: { show: false },
              lineStyle: { color: palette.muted, type: "dashed", opacity: 0.45, width: 1 },
              data: [{ xAxis: 0 }, { yAxis: 0 }],
            }
          : {},
    });
  });
  return {
    ...base,
    grid: { top: 35, left: presentation.compact ? 54 : 65, right: 32, bottom: 54 },
    graphic: [
      {
        type: "text",
        right: 34,
        top: 10,
        silent: true,
        style: {
          text: String(state.year),
          font: `${presentation.compact ? 40 : 64}px "Newsreader Variable", serif`,
          fill: transparent(palette.muted, 0.3),
        },
        z: -1,
      },
    ],
    tooltip: {
      ...(base.tooltip as object),
      trigger: "item",
      formatter: (raw: unknown) => {
        const point = raw as { seriesName: string; seriesId: string; value: [number, number] };
        const gdp = phaseObservation(snapshot, point.seriesId, "gdp", state.year);
        return createChartTooltip({
          title: point.seriesName,
          subtitle: String(state.year),
          rows: [
            { label: "实际 GDP 增速", value: `${point.value[0].toFixed(2)}%` },
            { label: "CPI 通胀率", value: `${point.value[1].toFixed(2)}%` },
            { label: "名义 GDP", value: formatMacroValue(gdp, "gdp") },
          ],
          footer:
            gdp === null ? "GDP 缺失，空心圆不表示经济规模" : "年度观测 · 坐标范围随播放保持固定",
        });
      },
    },
    xAxis: {
      type: "value",
      min: bounds.x[0],
      max: bounds.x[1],
      name: "实际 GDP 增速 (%)",
      nameLocation: "middle",
      nameGap: 32,
      nameTextStyle: { color: palette.muted, fontSize: 11 },
      splitNumber: 4,
      axisLabel: { color: palette.muted, fontSize: 11 },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: palette.border, opacity: 0.32, type: "dashed" } },
    },
    yAxis: {
      type: "value",
      min: bounds.y[0],
      max: bounds.y[1],
      name: "CPI 通胀率 (%)",
      nameTextStyle: { color: palette.muted, fontSize: 11 },
      splitNumber: 4,
      axisLabel: { color: palette.muted, fontSize: 11 },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: palette.border, opacity: 0.32, type: "dashed" } },
    },
    series,
  };
}
