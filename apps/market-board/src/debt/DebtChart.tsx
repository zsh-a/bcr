import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { init, use as register, type EChartsType } from "echarts/core";
import { BarChart, LineChart, ScatterChart } from "echarts/charts";
import {
  AriaComponent,
  GridComponent,
  MarkLineComponent,
  TooltipComponent,
} from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import { LabelLayout } from "echarts/features";
import { DEBT_FREQUENCY_LABELS } from "@bcr/market-data/debt";
import type { ChartPalette } from "../macro/chartStyle";
import type { DebtChartProps } from "./chart-types";
import { buildDebtChartOption, DEBT_SECTORS, debtChartUnit } from "./options";
import "./debt-chart.css";

register([
  BarChart,
  LineChart,
  ScatterChart,
  AriaComponent,
  GridComponent,
  MarkLineComponent,
  TooltipComponent,
  SVGRenderer,
  LabelLayout,
]);
function resolveColor(color: string, style: CSSStyleDeclaration) {
  const variable = /^var\((--[\w-]+)\)$/u.exec(color)?.[1];
  return variable ? style.getPropertyValue(variable).trim() || color : color;
}
function themedPalette(palette: ChartPalette, revision: number): ChartPalette {
  if (typeof document === "undefined") return palette;
  const style = getComputedStyle(document.documentElement);
  const native = (token: string, fallback: string) =>
    revision
      ? style.getPropertyValue(token).trim() || resolveColor(fallback, style)
      : resolveColor(fallback, style);
  return {
    text: native("--color-text", palette.text),
    muted: native("--color-faint", palette.muted),
    border: native("--color-border", palette.border),
    surface: native("--color-surface", palette.surface),
    colors: palette.colors.map((color) => resolveColor(color, style)),
  };
}

export function DebtChart({
  kind,
  palette,
  countries,
  period,
  focus,
  onSelect,
  trendSeries,
  structure,
  phasePoints,
}: DebtChartProps) {
  const host = useRef<HTMLDivElement>(null),
    instance = useRef<EChartsType | null>(null);
  const [compact, setCompact] = useState(false),
    [reducedMotion, setReducedMotion] = useState(false),
    [themeRevision, setThemeRevision] = useState(0),
    [ready, setReady] = useState(false);
  const select = useEffectEvent((data: unknown, value: unknown, seriesId: unknown) => {
    const country =
      data && typeof data === "object" ? (data as { country?: unknown }).country : undefined;
    const id =
      typeof country === "string"
        ? country
        : countries.find((country) => country.name === value || country.id === seriesId)?.id;
    if (id && countries.some((country) => country.id === id)) onSelect(id);
  });
  useEffect(() => {
    if (!host.current) return;
    const element = host.current,
      chart = init(element, undefined, { renderer: "svg" });
    instance.current = chart;
    let frame = 0;
    const resize = new ResizeObserver(() => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!element.clientWidth) return;
        chart.resize();
        setCompact(element.clientWidth < 580);
      });
    });
    resize.observe(element);
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => setReducedMotion(motion.matches);
    updateMotion();
    motion.addEventListener("change", updateMotion);
    const theme = new MutationObserver(() => setThemeRevision((value) => value + 1));
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "class"],
    });
    chart.on("click", (params) => select(params.data, params.value, params.seriesId));
    return () => {
      if (frame) cancelAnimationFrame(frame);
      resize.disconnect();
      theme.disconnect();
      motion.removeEventListener("change", updateMotion);
      chart.dispose();
      instance.current = null;
    };
  }, []);
  const chartPalette = useMemo(
    () => themedPalette(palette, themeRevision),
    [palette, themeRevision],
  );
  const option = useMemo(
    () =>
      buildDebtChartOption(
        {
          kind,
          palette: chartPalette,
          countries,
          period,
          focus,
          trendSeries,
          structure,
          phasePoints,
        },
        { compact, reducedMotion },
      ),
    [
      kind,
      chartPalette,
      countries,
      period,
      focus,
      trendSeries,
      structure,
      phasePoints,
      compact,
      reducedMotion,
    ],
  );
  useEffect(() => {
    instance.current?.setOption(option, { notMerge: true });
    setReady(true);
  }, [option]);
  const currentPoints = phasePoints.filter(
    (point) =>
      point.period === period &&
      countries.some((country) => country.id === point.country) &&
      Number.isFinite(point.gap) &&
      Number.isFinite(point.serviceDeviation),
  );
  const mixedUnits = new Set(trendSeries.map((series) => series.unit)).size > 1;
  const empty =
    kind === "structure"
      ? !structure.some((row) =>
          DEBT_SECTORS.some(({ key }) => row[key] !== null && Number.isFinite(row[key])),
        )
      : kind === "trend"
        ? !trendSeries.some((series) =>
            series.points.some((point) => point.value !== null && Number.isFinite(point.value)),
          )
        : currentPoints.length === 0;
  const emptyText =
    kind === "trend" && mixedUnits
      ? "当前序列单位不同，无法在同一坐标比较。"
      : kind === "phase"
        ? "本季缺少同步信用缺口或完整偿债基线，未沿用旧值。"
        : "所选期次暂无可用观测，缺失未绘为零。";
  const description =
    kind === "structure"
      ? "居民、非金融企业、一般政府债务占GDP比重，按国家分组并列展示。"
      : kind === "trend"
        ? "各国债务指标历史趋势，保留原始月度、季度或年度期次及缺失断点。"
        : `${period} 债务压力相位图：横轴信用缺口，纵轴偿债率偏离本国过去10年均值，单位均为百分点。`;
  return (
    <figure className={`debt-chart-figure debt-chart-figure-${kind}`}>
      {kind === "structure" && (
        <div className="debt-chart-legend" role="list" aria-label="债务部门">
          {DEBT_SECTORS.map(({ key, label }, index) => (
            <span role="listitem" key={key}>
              <i
                style={{ backgroundColor: chartPalette.colors[index] ?? chartPalette.text }}
                aria-hidden="true"
              />
              {label}
            </span>
          ))}
        </div>
      )}
      <div className="debt-chart-stage">
        <div
          ref={host}
          className={`debt-chart debt-chart-${kind}`}
          role="img"
          aria-label={description}
          data-kind={kind}
          data-ready={ready}
          data-period={period}
          data-focused-country={focus ?? ""}
          style={
            kind === "structure" ? { height: Math.max(280, structure.length * 82 + 60) } : undefined
          }
        />
        {(empty || (kind === "trend" && mixedUnits)) && (
          <p className="debt-chart-empty" role="status">
            {emptyText}
          </p>
        )}
      </div>
      <figcaption className="debt-chart-caption">
        {kind === "structure" ? (
          <p>单位：% GDP。部门分别展示，缺失留空；不将不同估值或统计边界的债务相加。</p>
        ) : kind === "trend" ? (
          <p>
            单位：{trendSeries[0] ? debtChartUnit(trendSeries[0].unit) : "—"} · 原始
            {[
              ...new Set(trendSeries.map((series) => DEBT_FREQUENCY_LABELS[series.frequency])),
            ].join(" / ")}
            期次，缺失处断线。
          </p>
        ) : (
          <>
            <p>横轴：信贷 / GDP 缺口（百分点） · 纵轴：DSR 减本国过去10年均值（百分点）。</p>
            <p>
              {period} · {currentPoints.length}/{countries.length}{" "}
              国有同步观测。淡线为前12季轨迹；零线分四象限，右侧信用高于趋势、上方偿债负担高于本国基线。
            </p>
          </>
        )}
      </figcaption>
    </figure>
  );
}
export default DebtChart;
