import type { EChartsOption, LineSeriesOption, ScatterSeriesOption } from "echarts";
import {
  DEBT_UNIT_LABELS,
  debtPeriodMonth,
  debtQuarterIndex,
  debtQuarterPeriod,
  formatDebtValue,
  type DebtPhasePoint,
  type DebtUnit,
} from "@bcr/market-data/debt";
import { baseChartOption, CHART_MONO, createChartTooltip, transparent } from "../macro/chartStyle";
import type { DebtChartInput } from "./chart-types";

export const DEBT_SECTORS = [
  { key: "household", label: "居民" },
  { key: "corporate", label: "非金融企业" },
  { key: "government", label: "一般政府" },
] as const;
interface Presentation {
  compact: boolean;
  reducedMotion: boolean;
}
interface TooltipEntry {
  seriesId?: string;
  seriesName?: string;
  axisValue?: string;
  data?: {
    country?: string;
    period?: string;
    value?: [number, number | null];
    point?: DebtPhasePoint;
  };
}
const finite = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value);
const number = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
export function debtChartUnit(unit: DebtUnit) {
  return (
    DEBT_UNIT_LABELS[unit] + (unit === "trillionLocal" || unit === "billionLocal" ? "本币" : "")
  );
}
function timestamp(period: string) {
  const month = debtPeriodMonth(period);
  return Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0);
}
function bounds(values: number[]): [number, number] {
  const min = Math.min(0, ...values),
    max = Math.max(0, ...values),
    padding = Math.max(0.5, (max - min) * 0.12);
  return [min - padding, max + padding];
}
function structureOption(input: DebtChartInput, presentation: Presentation): EChartsOption {
  const { palette, structure, focus, period } = input,
    { compact, reducedMotion } = presentation;
  const base = baseChartOption(palette, reducedMotion);
  const values = structure.flatMap((row) => DEBT_SECTORS.map(({ key }) => row[key])).filter(finite);
  return {
    ...base,
    grid: { top: 12, left: compact ? 38 : 58, right: compact ? 48 : 62, bottom: 45 },
    xAxis: {
      type: "value",
      min: Math.min(0, ...values),
      name: "% GDP",
      nameLocation: "middle",
      nameGap: 28,
      nameTextStyle: { color: palette.muted },
      splitNumber: compact ? 3 : 5,
      axisLabel: { color: palette.muted, fontFamily: CHART_MONO, fontSize: 11 },
      axisTick: { show: false },
      axisLine: { show: false },
      splitLine: { lineStyle: { color: palette.border, opacity: 0.4, type: "dashed" } },
    },
    yAxis: {
      type: "category",
      inverse: true,
      data: structure.map((row) => row.name),
      triggerEvent: true,
      axisLabel: { color: palette.text, fontSize: 12, width: compact ? 35 : 55, overflow: "break" },
      axisTick: { show: false },
      axisLine: { show: false },
    },
    tooltip: {
      ...(base.tooltip as object),
      trigger: "axis",
      axisPointer: { type: "shadow", shadowStyle: { color: transparent(palette.border, 0.15) } },
      formatter: (raw: unknown) => {
        const entries = (Array.isArray(raw) ? raw : [raw]) as TooltipEntry[],
          first = entries[0];
        const row = structure.find(
          (row) => row.country === first?.data?.country || row.name === first?.axisValue,
        );
        return createChartTooltip({
          title: row?.name ?? "部门债务",
          subtitle: `${period} · % GDP`,
          rows: DEBT_SECTORS.map(({ key, label }, index) => ({
            label,
            value: formatDebtValue(row?.[key], "percentGdp"),
            color: palette.colors[index] ?? palette.text,
          })),
          footer: "分部门并列展示；估值及统计边界不同，不将三项相加。",
        });
      },
    },
    series: DEBT_SECTORS.map(({ key, label }, index) => ({
      id: key,
      name: label,
      type: "bar" as const,
      barMaxWidth: 13,
      barGap: "40%",
      itemStyle: { color: palette.colors[index] ?? palette.text },
      label: {
        show: true,
        position: "right",
        distance: 5,
        fontFamily: CHART_MONO,
        fontSize: 12,
        opacity: 1,
        color: palette.text,
        formatter: (entry: { value: unknown }) =>
          finite(typeof entry.value === "number" ? entry.value : null)
            ? number.format(Number(entry.value))
            : "",
      },
      emphasis: { itemStyle: { borderColor: palette.text, borderWidth: 1 } },
      data: structure.map((row) => ({
        value: finite(row[key]) ? row[key] : null,
        country: row.country,
        itemStyle: { borderColor: palette.text, borderWidth: focus === row.country ? 1 : 0 },
      })),
    })),
  };
}
function trendOption(input: DebtChartInput, presentation: Presentation): EChartsOption {
  const { palette, trendSeries, focus } = input,
    { compact, reducedMotion } = presentation;
  const base = baseChartOption(palette, reducedMotion),
    unit = trendSeries[0]?.unit;
  const compatible = new Set(trendSeries.map((series) => series.unit)).size <= 1;
  const series: LineSeriesOption[] = compatible
    ? trendSeries.map((series) => ({
        id: series.id,
        name: series.name,
        type: "line",
        symbol: "circle",
        symbolSize: 6,
        showSymbol: false,
        connectNulls: false,
        lineStyle: {
          color: series.color,
          width: focus === series.id ? 2.8 : 1.7,
          opacity: !focus || focus === series.id ? 1 : 0.55,
        },
        itemStyle: { color: series.color },
        emphasis: { lineStyle: { width: 3 } },
        data: series.points
          .filter((point) => Number.isFinite(timestamp(point.period)))
          .map((point) => ({
            value: [timestamp(point.period), finite(point.value) ? point.value : null],
            period: point.period,
            country: series.id,
          })),
      }))
    : [];
  return {
    ...base,
    grid: { top: 26, left: compact ? 54 : 72, right: 18, bottom: 36 },
    xAxis: {
      type: "time",
      splitNumber: compact ? 3 : 6,
      axisLabel: { color: palette.muted, fontSize: 11, hideOverlap: true },
      axisTick: { show: false },
      axisLine: { show: false },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      scale: true,
      name: unit ? debtChartUnit(unit) : "",
      nameTextStyle: { color: palette.muted, fontSize: 11 },
      splitNumber: 4,
      axisLabel: { color: palette.muted, fontSize: 11 },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: palette.border, opacity: 0.4, type: "dashed" } },
    },
    tooltip: {
      ...(base.tooltip as object),
      formatter: (raw: unknown) => {
        const entries = (Array.isArray(raw) ? raw : [raw]) as TooltipEntry[];
        return createChartTooltip({
          title: entries[0]?.data?.period ?? "原始期次",
          subtitle: "保留原始统计频率",
          rows: entries.map((entry) => {
            const source = trendSeries.find((series) => series.id === entry.seriesId);
            return {
              label: `${source?.name ?? entry.seriesName ?? ""} · ${entry.data?.period ?? "—"}`,
              value: formatDebtValue(entry.data?.value?.[1], source?.unit),
              color: source?.color ?? palette.text,
            };
          }),
        });
      },
    },
    series,
  };
}
function phaseOption(input: DebtChartInput, presentation: Presentation): EChartsOption {
  const { palette, countries, phasePoints, period, focus } = input,
    { compact, reducedMotion } = presentation;
  const base = baseChartOption(palette, reducedMotion),
    selectedQuarter = debtQuarterIndex(period);
  const ids = new Set(countries.map((country) => country.id));
  const valid = phasePoints.filter(
    (point) =>
      ids.has(point.country) &&
      Number.isFinite(debtQuarterIndex(point.period)) &&
      finite(point.gap) &&
      finite(point.serviceDeviation),
  );
  const xb = bounds(valid.map((point) => point.gap)),
    yb = bounds(valid.map((point) => point.serviceDeviation));
  const series: (LineSeriesOption | ScatterSeriesOption)[] = [
    {
      id: "zero-reference",
      type: "scatter",
      data: [],
      silent: true,
      markLine: {
        silent: true,
        symbol: "none",
        label: { show: false },
        lineStyle: { color: palette.muted, opacity: 0.7, type: "dashed" },
        data: [{ xAxis: 0 }, { yAxis: 0 }],
      },
    },
  ];
  for (const country of countries) {
    const trail = Array.from({ length: 13 }, (_, index) => {
      const quarter = debtQuarterPeriod(selectedQuarter - 12 + index);
      const point = valid.find((point) => point.country === country.id && point.period === quarter);
      return point ? [point.gap, point.serviceDeviation] : [null, null];
    });
    series.push({
      id: `trail:${country.id}`,
      type: "line",
      z: 1,
      data: trail,
      symbol: "none",
      connectNulls: false,
      silent: true,
      lineStyle: {
        color: country.color,
        width: 1.5,
        opacity: !focus || focus === country.id ? 0.5 : 0.2,
      },
      tooltip: { show: false },
    });
    const point = valid.find((point) => point.country === country.id && point.period === period);
    if (!point) continue;
    series.push({
      id: country.id,
      name: country.name,
      type: "scatter",
      z: 5,
      data: [
        { value: [point.gap, point.serviceDeviation], country: country.id, point } as {
          value: number[];
          country: string;
          point: DebtPhasePoint;
        },
      ],
      symbolSize: focus === country.id ? 17 : 12,
      itemStyle: {
        color: country.color,
        opacity: !focus || focus === country.id ? 1 : 0.65,
        borderColor: palette.surface,
        borderWidth: 2,
      },
      label: {
        show: true,
        formatter: country.name,
        position: "top",
        distance: 8,
        fontSize: 12,
        color: palette.text,
        padding: [3, 5],
        backgroundColor: transparent(palette.surface, 0.94),
      },
      labelLayout: { moveOverlap: "shiftY", hideOverlap: true },
    });
  }
  return {
    ...base,
    grid: { top: 36, left: compact ? 46 : 64, right: compact ? 18 : 30, bottom: 52 },
    xAxis: {
      type: "value",
      min: xb[0],
      max: xb[1],
      name: compact ? "信用缺口 · 点" : "信贷 / GDP 缺口 · 百分点",
      nameLocation: "middle",
      nameGap: 30,
      nameTextStyle: { color: palette.muted, fontSize: 11 },
      splitNumber: compact ? 3 : 5,
      axisLabel: {
        color: palette.muted,
        fontSize: 11,
        hideOverlap: true,
        formatter: (value: number) => number.format(value),
      },
      axisTick: { show: false },
      axisLine: { show: false },
      splitLine: { lineStyle: { color: palette.border, opacity: 0.3, type: "dashed" } },
    },
    yAxis: {
      type: "value",
      min: yb[0],
      max: yb[1],
      name: compact ? "ΔDSR · 百分点" : "偿债率较本国10年均值 · 百分点",
      nameTextStyle: { color: palette.muted, fontSize: 11, align: "left" },
      splitNumber: 4,
      axisLabel: {
        color: palette.muted,
        fontSize: 11,
        formatter: (value: number) => number.format(value),
      },
      axisTick: { show: false },
      axisLine: { show: false },
      splitLine: { lineStyle: { color: palette.border, opacity: 0.3, type: "dashed" } },
    },
    tooltip: {
      ...(base.tooltip as object),
      trigger: "item",
      formatter: (raw: unknown) => {
        const entry = raw as TooltipEntry,
          point = entry.data?.point;
        return createChartTooltip({
          title: entry.seriesName ?? "债务压力坐标",
          subtitle: point?.period ?? period,
          rows: [
            { label: "信贷 / GDP 缺口", value: formatDebtValue(point?.gap, "percentagePoints") },
            {
              label: "偿债率偏离本国基线",
              value: formatDebtValue(point?.serviceDeviation, "percentagePoints"),
            },
            {
              label: "当期私人部门偿债率",
              value: formatDebtValue(point?.service, "percentIncome"),
            },
            { label: "本国过去10年均值", value: formatDebtValue(point?.baseline, "percentIncome") },
          ],
          footer: `基线取本季之前 ${point?.baselineCount ?? 40} 个连续季度；描述相对本国历史的位置。`,
        });
      },
    },
    series,
  };
}
export function buildDebtChartOption(
  input: DebtChartInput,
  presentation: Presentation,
): EChartsOption {
  return input.kind === "structure"
    ? structureOption(input, presentation)
    : input.kind === "trend"
      ? trendOption(input, presentation)
      : phaseOption(input, presentation);
}
