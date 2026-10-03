import type { TrendResult } from "@bcr/quant-core/trend";
import {
  BaselineSeries,
  LineSeries,
  createChart,
  type AutoscaleInfo,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useMemo, useRef } from "react";
import { number, trendPerformancePoints, type EvaluationWindow } from "./evaluation";

export function TrendPerformanceChart({
  result,
  initialCapital,
  window,
}: {
  result: TrendResult;
  initialCapital: number;
  window: EvaluationWindow;
}) {
  const root = useRef<HTMLDivElement>(null);
  const points = useMemo(
    () => trendPerformancePoints(result, initialCapital, window),
    [result, initialCapital, window.startTime, window.endTime],
  );
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const css = getComputedStyle(element);
    const chart = createChart(element, {
      autoSize: true,
      layout: { background: { color: "transparent" }, fontFamily: css.fontFamily, fontSize: 11 },
      timeScale: { borderVisible: false, timeVisible: points.sampled, secondsVisible: false },
      rightPriceScale: { borderVisible: false },
      handleScroll: { vertTouchDrag: false },
      localization: {
        timeFormatter: (value: number) =>
          new Date(value * 1000)
            .toISOString()
            .slice(0, points.sampled ? 16 : 10)
            .replace("T", " "),
      },
    });
    const equity = chart.addSeries(LineSeries, {
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      priceFormat: { type: "price", precision: 3, minMove: 0.001 },
    });
    const data = (values: { time: number; value: number }[]) =>
      values.map((point) => ({
        time: Math.floor(point.time / 1000) as UTCTimestamp,
        value: point.value,
      }));
    equity.setData(data(points.equity));
    const drawdown = !points.sampled
      ? chart.addSeries(
          BaselineSeries,
          {
            lineWidth: 1,
            baseValue: { type: "price", price: 0 },
            topFillColor1: "transparent",
            topFillColor2: "transparent",
            bottomFillColor1: "rgba(216, 97, 103, 0.02)",
            bottomFillColor2: "rgba(216, 97, 103, 0.12)",
            priceLineVisible: false,
            lastValueVisible: false,
            priceFormat: {
              type: "custom",
              formatter: (value: number) => `${number(value)}%`,
              minMove: 0.01,
            },
            autoscaleInfoProvider: (base: () => AutoscaleInfo | null) => {
              const info = base();
              if (info?.priceRange)
                info.priceRange.maxValue = Math.max(0, info.priceRange.maxValue);
              return info;
            },
          },
          1,
        )
      : undefined;
    const intraday = !points.sampled
      ? chart.addSeries(
          LineSeries,
          {
            lineWidth: 1,
            lineStyle: 2,
            priceLineVisible: false,
            lastValueVisible: false,
            priceFormat: {
              type: "custom",
              formatter: (value: number) => `${number(value)}%`,
              minMove: 0.01,
            },
          },
          1,
        )
      : undefined;
    drawdown?.setData(data(points.drawdown));
    intraday?.setData(data(points.intraday));
    chart.panes()[0]?.setStretchFactor(2);
    chart.panes()[1]?.setStretchFactor(1);
    const style = () => {
      const current = getComputedStyle(element);
      const accent = current.getPropertyValue("--color-accent").trim() || "#1b8275";
      const danger = current.getPropertyValue("--color-danger").trim() || "#d86167";
      const muted = current.getPropertyValue("--color-muted").trim() || "#7e8993";
      chart.applyOptions({
        layout: { textColor: muted },
        grid: {
          vertLines: { visible: false },
          horzLines: { color: current.getPropertyValue("--color-border").trim() || "#ddd" },
        },
      });
      equity.applyOptions({ color: accent });
      drawdown?.applyOptions({ topLineColor: danger, bottomLineColor: danger });
      intraday?.applyOptions({ color: muted });
    };
    style();
    const observer = new MutationObserver(style);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "style"],
    });
    chart.timeScale().fitContent();
    return () => {
      observer.disconnect();
      chart.remove();
    };
  }, [points]);
  return (
    <div className="trend-performance">
      <div
        ref={root}
        className={`trend-performance-chart${points.sampled ? " is-sampled" : ""}`}
        role="img"
        aria-label="组合净值图"
        data-evaluation-version={points.sampled ? "legacy" : "2"}
        data-daily-points={points.sampled ? undefined : points.equity.length - 1}
      />
      <div className="trend-performance-legend">
        <span className="trend-performance-equity">{points.sampled ? "抽样净值" : "日终净值"}</span>
        {!points.sampled && (
          <>
            <span className="trend-performance-drawdown">日终回撤</span>
            <span className="trend-performance-intraday">每日最低分钟回撤</span>
          </>
        )}
      </div>
      <p className="trend-help">
        {points.sampled
          ? "旧结果仅保留抽样净值预览；未展示精确日终回撤、每日最低分钟回撤或月度推算。"
          : "上下图共用时间轴。净值初始为 1.000；日终回撤按日终权益前高计算，虚线保留当日最深的分钟级回撤。末尾不足一日时显示该覆盖区间的期末权益。"}
      </p>
    </div>
  );
}
