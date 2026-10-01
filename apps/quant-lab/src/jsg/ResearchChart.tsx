import { useEffect, useRef, useState } from "react";
import {
  AreaSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  createChart,
  type IChartApi,
  type AutoscaleInfo,
  type Time,
} from "lightweight-charts";
import { Button, Input, Spinner } from "@bcr/react";
import type { RuntimeServices } from "@bcr/core";
import { dateText, type JsgResult } from "./model";
import type { SelectedRun } from "./session";
import { queryCurve } from "./result-reader";
import { COMPARISON_COLORS } from "./comparison";
import { money, percent } from "./Orders";

function day(time: Time): string {
  if (typeof time === "string") return time;
  if (typeof time === "number") return new Date(time * 1000).toISOString().slice(0, 10);
  return `${time.year}-${String(time.month).padStart(2, "0")}-${String(time.day).padStart(2, "0")}`;
}
function mergePoints(
  preview: JsgResult["equity"],
  detail: JsgResult["equity"],
  from: string,
  to: string,
) {
  return [...preview.filter((p) => p.date < from || p.date > to), ...detail].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
}
export default function ResearchChart({
  services,
  selected,
  comparisons,
}: {
  services: RuntimeServices;
  selected: SelectedRun;
  comparisons: SelectedRun[];
}) {
  const container = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const visibleRange =
    useRef<ReturnType<ReturnType<IChartApi["timeScale"]>["getVisibleRange"]>>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(selected.result.equity.at(-1));
  const [inspectDate, setInspectDate] = useState("");
  const [range, setRange] = useState<number | null>(null);
  const [hover, setHover] = useState<{
    date: string;
    net?: number;
    drawdown?: number;
    baselines: (number | undefined)[];
  } | null>(null);
  const result = selected.result,
    capital = selected.run.config.initialCapital;
  const first = dateText(selected.run.startDate),
    last = dateText(selected.run.endDate);
  useEffect(() => {
    if (!container.current) return;
    setHover(null);
    let disposed = false,
      timer: ReturnType<typeof setTimeout> | undefined,
      frame = 0;
    let abort: AbortController | null = null,
      loadedRange = "",
      querying = false;
    const chart = createChart(container.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        fontFamily: "IBM Plex Mono, monospace",
        fontSize: 11,
        attributionLogo: false,
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderVisible: false, minimumWidth: 68 },
      timeScale: {
        borderVisible: false,
        timeVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
      },
      handleScroll: { vertTouchDrag: false },
    });
    chartRef.current = chart;
    const net = chart.addSeries(LineSeries, {
      title: "净值",
      lineWidth: 2,
      priceFormat: { type: "price", precision: 3, minMove: 0.001 },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    const baselines = comparisons.map((_, index) =>
      chart.addSeries(LineSeries, {
        title: `对照 ${index + 1}`,
        lineWidth: 1,
        lineStyle: 2,
        lastValueVisible: false,
        priceLineVisible: false,
        priceFormat: { type: "price", precision: 3, minMove: 0.001 },
      }),
    );
    const drawdown = chart.addSeries(
      AreaSeries,
      {
        title: "回撤 %",
        invertFilledArea: true,
        autoscaleInfoProvider: (original: () => AutoscaleInfo | null) => {
          const info = original();
          return info?.priceRange
            ? {
                ...info,
                priceRange: { minValue: Math.min(-0.01, info.priceRange.minValue), maxValue: 0 },
              }
            : info;
        },
        lineWidth: 1,
        lastValueVisible: false,
        priceLineVisible: false,
        priceFormat: {
          type: "custom",
          formatter: (value: number) => `${value.toFixed(1)}%`,
          minMove: 0.01,
        },
      },
      1,
    );
    chart.panes()[0]?.setStretchFactor(4);
    chart.panes()[1]?.setStretchFactor(1);
    const applyTheme = () => {
      const css = getComputedStyle(container.current!);
      const color = (key: string) => css.getPropertyValue(`--color-${key}`).trim();
      chart.applyOptions({
        layout: {
          textColor: color("muted"),
          panes: { separatorColor: color("border"), separatorHoverColor: color("raised") },
        },
        grid: { vertLines: { visible: false }, horzLines: { color: color("raised") } },
        crosshair: {
          vertLine: { color: color("faint"), labelBackgroundColor: color("overlay") },
          horzLine: { color: color("faint"), labelBackgroundColor: color("overlay") },
        },
      });
      net.applyOptions({ color: color("accent") });
      baselines.forEach((series, index) =>
        series.applyOptions({ color: color(COMPARISON_COLORS[index]!) }),
      );
      drawdown.applyOptions({
        lineColor: color("danger"),
        topColor: "transparent",
        bottomColor:
          document.documentElement.dataset["theme"] === "light"
            ? "rgba(181,47,53,0.14)"
            : "rgba(255,118,109,0.14)",
      });
    };
    applyTheme();
    const observer = new MutationObserver(applyTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    const setPoints = (points: JsgResult["equity"]) => {
      net.setData(points.map((p) => ({ time: p.date, value: p.equity / capital })));
      drawdown.setData(points.map((p) => ({ time: p.date, value: p.drawdown * 100 })));
    };
    setPoints(result.equity);
    baselines.forEach((series, index) =>
      series.setData(
        comparisons[index]!.result.equity.map((p) => ({
          time: p.date,
          value: p.equity / comparisons[index]!.run.config.initialCapital,
        })),
      ),
    );
    if (visibleRange.current) chart.timeScale().setVisibleRange(visibleRange.current);
    else chart.timeScale().fitContent();
    const readRange = (from: string, to: string) => {
      if (querying) return;
      const key = `${from}:${to}`;
      if (key === loadedRange) return;
      if (timer) clearTimeout(timer);
      abort?.abort();
      const request = new AbortController();
      abort = request;
      timer = setTimeout(() => {
        setLoading(true);
        setError(null);
        void Promise.all([
          queryCurve(services, result, from, to, request.signal),
          ...comparisons.map((other) =>
            queryCurve(services, other.result, from, to, request.signal),
          ),
        ])
          .then(([points, ...comparisonPoints]) => {
            if (disposed || request.signal.aborted) return;
            const range = chart.timeScale().getVisibleRange();
            querying = true;
            setPoints(mergePoints(result.equity, points, from, to));
            baselines.forEach((series, index) =>
              series.setData(
                mergePoints(
                  comparisons[index]!.result.equity,
                  comparisonPoints[index]!,
                  from,
                  to,
                ).map((p) => ({
                  time: p.date,
                  value: p.equity / comparisons[index]!.run.config.initialCapital,
                })),
              ),
            );
            if (range) chart.timeScale().setVisibleRange(range);
            querying = false;
            loadedRange = key;
            setLoading(false);
          })
          .catch((caught: unknown) => {
            if (!disposed && !request.signal.aborted) {
              setError(caught instanceof Error ? caught.message : String(caught));
              setLoading(false);
            }
          });
      }, 200);
    };
    chart.timeScale().subscribeVisibleTimeRangeChange((range) => {
      visibleRange.current = range;
      if (range && !querying)
        readRange(
          day(range.from) < first ? first : day(range.from),
          day(range.to) > last ? last : day(range.to),
        );
    });
    readRange(first, last);
    chart.subscribeCrosshairMove((event) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (disposed) return;
        if (!event.time) {
          setHover(null);
          return;
        }
        const n = event.seriesData.get(net),
          d = event.seriesData.get(drawdown);
        setHover({
          date: day(event.time),
          ...(n && "value" in n ? { net: n.value } : {}),
          ...(d && "value" in d ? { drawdown: d.value / 100 } : {}),
          baselines: baselines.map((series) => {
            const value = event.seriesData.get(series);
            return value && "value" in value && typeof value.value === "number"
              ? value.value
              : undefined;
          }),
        });
      });
    });
    return () => {
      disposed = true;
      abort?.abort();
      if (timer) clearTimeout(timer);
      cancelAnimationFrame(frame);
      observer.disconnect();
      chartRef.current = null;
      chart.remove();
    };
  }, [services, result, capital, comparisons, first, last]);
  useEffect(() => {
    if (!inspectDate) return;
    const abort = new AbortController();
    void queryCurve(services, selected.result, inspectDate, inspectDate, abort.signal)
      .then((points) => {
        if (!abort.signal.aborted) setCursor(points[0]);
      })
      .catch((caught: unknown) => {
        if (!abort.signal.aborted)
          setError(caught instanceof Error ? caught.message : String(caught));
      });
    return () => abort.abort();
  }, [services, selected.result, inspectDate]);
  const zoom = (months: number | null) => {
    setRange(months);
    if (months === null) {
      chartRef.current?.timeScale().fitContent();
      return;
    }
    const start = new Date(`${last}T00:00:00Z`);
    start.setUTCMonth(start.getUTCMonth() - months);
    const from = start.toISOString().slice(0, 10);
    chartRef.current?.timeScale().setVisibleRange({ from: from < first ? first : from, to: last });
  };
  return (
    <section className="research-chart" aria-label="净值与回撤">
      <div className="research-chart-heading">
        <div>
          <h2 title="以初始本金归一化，初始净值为 1">净值与回撤</h2>
        </div>
        <div className="research-chart-ranges" role="group" aria-label="图表查看范围">
          <Button variant="ghost" size="sm" aria-pressed={range === 3} onClick={() => zoom(3)}>
            3 月
          </Button>
          <Button variant="ghost" size="sm" aria-pressed={range === 12} onClick={() => zoom(12)}>
            1 年
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={range === null}
            onClick={() => zoom(null)}
          >
            全部
          </Button>
        </div>
      </div>
      <div className="research-chart-legend">
        <span>
          <i />
          本次运行{" "}
          <b>
            {hover?.net?.toFixed(3) ??
              (selected.result.metrics.finalEquity / selected.run.config.initialCapital).toFixed(3)}
          </b>
        </span>
        {comparisons.map((comparison, index) => (
          <span
            key={comparison.run.id}
            className="comparison"
            style={{ color: `var(--color-${COMPARISON_COLORS[index]})` }}
            title={`${comparison.run.name} · ${comparison.run.config.stockCount} 只`}
          >
            <i style={{ background: "currentColor" }} />
            对照 {index + 1}{" "}
            <b>
              {hover?.baselines[index]?.toFixed(3) ??
                (
                  comparison.result.metrics.finalEquity / comparison.run.config.initialCapital
                ).toFixed(3)}
            </b>
          </span>
        ))}
        <span>
          {hover?.date ?? last}
          {hover?.drawdown !== undefined ? ` · 回撤 ${percent(hover.drawdown)}` : ""}
        </span>
        {loading && <Spinner size="sm" />}
      </div>
      <div
        ref={container}
        className="research-chart-canvas"
        role="img"
        aria-label={`净值曲线，${first} 至 ${last}，总收益 ${percent(selected.result.metrics.totalReturn)}，最大回撤 ${percent(selected.result.metrics.maxDrawdown)}`}
      />
      {error && (
        <p className="research-error" role="alert">
          图表读取失败：{error}
        </p>
      )}
      <details className="research-chart-inspector">
        <summary>查看交易日</summary>
        <div className="research-chart-bottom">
          <label>
            交易日{" "}
            <Input
              type="date"
              aria-label="查看净值日期"
              value={inspectDate || cursor?.date || ""}
              min={first}
              max={last}
              onChange={(event) => setInspectDate(event.currentTarget.value)}
            />
          </label>
          <output aria-live="polite">
            {cursor
              ? `净值 ${(cursor.equity / selected.run.config.initialCapital).toFixed(3)} · 回撤 ${percent(cursor.drawdown)} · 现金 ¥${money(cursor.cash)}`
              : "该日没有交易记录"}
          </output>
        </div>
      </details>
      <div className="research-chart-credit">
        <span>拖动平移 · 滚轮或双指缩放</span>
        <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">
          TradingView Lightweight Charts™ · Copyright (с) 2025 TradingView, Inc.
        </a>
      </div>
    </section>
  );
}
