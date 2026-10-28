import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { init, use as register, type EChartsType } from "echarts/core";
import { LineChart, ScatterChart } from "echarts/charts";
import {
  GridComponent,
  MarkLineComponent,
  TooltipComponent,
  GraphicComponent,
  AriaComponent,
} from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import { LabelLayout } from "echarts/features";
import type { EChartsOption, LineSeriesOption, ScatterSeriesOption } from "echarts";
import {
  CYCLE_COUNTRIES,
  CYCLE_INDICATORS,
  cycleChartObservations,
  cycleDisplayUnit,
  formatCycleValue,
  getCycleSeries,
  observationMonth,
  shiftMonth,
  type CycleSnapshot,
  type CycleSpacePoint,
} from "@bcr/market-data/cycle";
import {
  baseChartOption,
  createChartTooltip,
  transparent,
  type ChartPalette,
} from "../macro/chartStyle";
import { cycleTrendEnd, type CycleViewState } from "./state";

register([
  LineChart,
  ScatterChart,
  GridComponent,
  MarkLineComponent,
  TooltipComponent,
  GraphicComponent,
  AriaComponent,
  SVGRenderer,
  LabelLayout,
]);
const dateNumber = (period: string) => {
  if (period.length === 10) return Date.parse(`${period}T00:00:00Z`);
  const month = observationMonth(period);
  return Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0);
};
export function CycleChart({
  snapshot,
  state,
  palette,
  points,
  kind,
  onSelect,
}: {
  snapshot: CycleSnapshot;
  state: CycleViewState;
  palette: ChartPalette;
  points: CycleSpacePoint[];
  kind: "phase" | "trend";
  onSelect: (country: string) => void;
}) {
  const element = useRef<HTMLDivElement>(null),
    instance = useRef<EChartsType | null>(null);
  const [compact, setCompact] = useState(false),
    [reducedMotion, setReducedMotion] = useState(false);
  const select = useEffectEvent(onSelect);
  useEffect(() => {
    if (!element.current) return;
    const chart = init(element.current, undefined, { renderer: "svg" });
    instance.current = chart;
    const resize = new ResizeObserver(() => {
      chart.resize();
      setCompact((element.current?.clientWidth ?? 0) < 580);
    });
    resize.observe(element.current);
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => setReducedMotion(motion.matches);
    updateMotion();
    motion.addEventListener("change", updateMotion);
    chart.on("click", (params) => {
      const id = (params.data as { country?: string } | undefined)?.country;
      if (id) select(id);
    });
    return () => {
      resize.disconnect();
      motion.removeEventListener("change", updateMotion);
      chart.dispose();
      instance.current = null;
    };
  }, []);
  const option = useMemo<EChartsOption>(() => {
    const base = baseChartOption(palette, reducedMotion),
      series: (LineSeriesOption | ScatterSeriesOption)[] = [];
    if (kind === "phase") {
      state.countries.forEach((country, index) => {
        const color = palette.colors[index] ?? palette.text;
        const trail = Array.from({ length: 13 }, (_, offset) => {
          const point = points.find(
            (item) =>
              item.country === country && item.period === shiftMonth(state.period, offset - 12),
          );
          return point ? [point.level, point.momentum] : [null, null];
        });
        series.push({
          id: `trail:${country}`,
          type: "line",
          z: 1,
          data: trail,
          symbol: "none",
          connectNulls: false,
          silent: true,
          lineStyle: { color, width: 1.5, opacity: 0.35 },
          tooltip: { show: false },
        });
        const point = points.find(
          (item) => item.country === country && item.period === state.period,
        );
        if (point)
          series.push({
            id: country,
            name: CYCLE_COUNTRIES.find((item) => item.id === country)?.name ?? country,
            type: "scatter",
            z: 5,
            data: [
              { value: [point.level, point.momentum], country } as {
                value: number[];
                country: string;
              },
            ],
            symbolSize: state.focus === country ? 17 : 11,
            itemStyle: {
              color,
              opacity: state.focus === country ? 1 : 0.75,
              borderWidth: 2,
              borderColor: palette.surface,
            },
            label: {
              show: true,
              formatter: CYCLE_COUNTRIES.find((item) => item.id === country)?.name ?? country,
              position: "top",
              distance: 8,
              color: palette.text,
              fontSize: 12,
              padding: [3, 5],
              backgroundColor: transparent(palette.surface, 0.9),
            },
            labelLayout: { moveOverlap: "shiftY", hideOverlap: true },
            markLine:
              index === 0
                ? {
                    silent: true,
                    symbol: "none",
                    label: { show: false },
                    lineStyle: { color: palette.muted, opacity: 0.6, type: "dashed" },
                    data: [{ xAxis: 100 }, { yAxis: 0 }],
                  }
                : {},
          });
      });
      const x = points.map((point) => point.level),
        y = points.map((point) => point.momentum);
      const pad = (values: number[], baseline: number): [number, number] => {
        const min = Math.min(baseline, ...values),
          max = Math.max(baseline, ...values),
          padding = Math.max(0.2, (max - min) * 0.1);
        return [min - padding, max + padding];
      };
      const xb = pad(x, 100),
        yb = pad(y, 0);
      return {
        ...base,
        grid: { top: 30, left: compact ? 52 : 65, right: 30, bottom: 52 },
        xAxis: {
          type: "value",
          min: xb[0],
          max: xb[1],
          name: "CLI · 100 为长期趋势",
          nameLocation: "middle",
          nameGap: 30,
          nameTextStyle: { color: palette.muted },
          splitNumber: 4,
          axisLabel: {
            color: palette.muted,
            fontSize: 11,
            formatter: (value: number) => value.toFixed(1),
          },
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { lineStyle: { color: palette.border, opacity: 0.3, type: "dashed" } },
        },
        yAxis: {
          type: "value",
          min: yb[0],
          max: yb[1],
          name: "近三个月变化 · 指数点",
          nameTextStyle: { color: palette.muted },
          splitNumber: 4,
          axisLabel: {
            color: palette.muted,
            fontSize: 11,
            formatter: (value: number) => value.toFixed(1),
          },
          axisTick: { show: false },
          splitLine: { lineStyle: { color: palette.border, opacity: 0.3, type: "dashed" } },
        },
        tooltip: {
          ...(base.tooltip as object),
          trigger: "item",
          formatter: (raw: unknown) => {
            const point = raw as { seriesName: string; value: number[] };
            return createChartTooltip({
              title: point.seriesName,
              subtitle: state.period,
              rows: [
                { label: "CLI 水平", value: formatCycleValue(point.value[0]) },
                { label: "三个月变化", value: `${formatCycleValue(point.value[1])} 指数点` },
              ],
              footer: "这是领先景气位置，不是 GDP 增速或衰退概率。",
            });
          },
        },
        series,
      };
    }
    const end = cycleTrendEnd(snapshot, state);
    const baseline = ["cli", "businessConfidence", "consumerConfidence"].includes(state.metric)
      ? 100
      : state.metric.startsWith("pmi")
        ? 50
        : [
              "loanStandards",
              "loanDemand",
              "realPolicyRate",
              "payrollChange",
              "coreInflation3m",
              "realHousePrices",
              "nominalHousePrices",
              "privateDemandGrowth",
            ].includes(state.metric)
          ? 0
          : null;
    const startPeriod =
      state.window === "all" ? "2000-01" : shiftMonth(end, state.window === "10y" ? -119 : -59);
    state.countries.forEach((country, index) => {
      const item = getCycleSeries(snapshot, country, state.metric);
      if (!item) return;
      const color = palette.colors[index] ?? palette.text;
      const data = cycleChartObservations(item)
        .filter(
          (point) =>
            observationMonth(point.period) >= startPeriod && observationMonth(point.period) <= end,
        )
        .map((point) => ({
          value: [dateNumber(point.period), point.value],
          period: point.period,
          country,
        }));
      series.push({
        id: country,
        name: CYCLE_COUNTRIES.find((entry) => entry.id === country)?.name ?? country,
        type: "line",
        data,
        symbol: "circle",
        showSymbol: false,
        connectNulls: false,
        lineStyle: { color, width: country === state.focus ? 2.6 : 1.7, opacity: 0.9 },
        itemStyle: { color },
        emphasis: { lineStyle: { width: 3 } },
        markLine:
          series.length === 0 && baseline !== null
            ? {
                silent: true,
                symbol: "none",
                label: { show: false },
                lineStyle: { color: palette.muted, type: "dashed", opacity: 0.5 },
                data: [{ yAxis: baseline! }],
              }
            : {},
      });
    });
    return {
      ...base,
      grid: { top: 18, left: compact ? 58 : 72, right: 25, bottom: 35 },
      xAxis: {
        type: "time",
        min: dateNumber(startPeriod),
        max: Date.UTC(Number(end.slice(0, 4)), Number(end.slice(5, 7)), 0),
        splitNumber: compact ? 3 : 6,
        axisLabel: {
          color: palette.muted,
          fontSize: 11,
          hideOverlap: true,
          ...(compact ? { formatter: "{yyyy}" } : {}),
        },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
      },
      yAxis: {
        type: "value",
        scale: true,
        splitNumber: 4,
        axisLabel: { color: palette.muted, fontSize: 11 },
        splitLine: { lineStyle: { color: palette.border, opacity: 0.3, type: "dashed" } },
      },
      tooltip: {
        ...(base.tooltip as object),
        formatter: (raw: unknown) => {
          const entries = (Array.isArray(raw) ? raw : [raw]) as {
            seriesName: string;
            seriesId: string;
            value: [number, number | null];
            data: { period: string };
          }[];
          return createChartTooltip({
            title: entries[0]?.data.period ?? state.period,
            subtitle: CYCLE_INDICATORS.find((item) => item.id === state.metric)?.name ?? "",
            rows: entries.map((entry) => ({
              label: entry.seriesName,
              value: formatCycleValue(
                entry.value[1],
                cycleDisplayUnit(getCycleSeries(snapshot, entry.seriesId, state.metric)!),
              ),
              color: palette.colors[state.countries.indexOf(entry.seriesId)] ?? palette.text,
            })),
          });
        },
      },
      series,
    };
  }, [snapshot, state, points, palette, kind, compact, reducedMotion]);
  useEffect(() => {
    instance.current?.setOption(option, { notMerge: true });
  }, [option]);
  return (
    <div
      ref={element}
      className={`cycle-chart cycle-chart-${kind}`}
      role="img"
      aria-label={
        kind === "phase"
          ? `${state.period} 年月领先景气相位图，可点击国家；精确数值见下方数据表。`
          : "周期指标历史趋势，保留原始缺失和统计频率。"
      }
      data-kind={kind}
      data-ready="true"
    />
  );
}
