import { MINUTE } from "@bcr/market-data/binance/model";
import {
  clipChartRange,
  periodLabel,
  type ChartFocus,
  type ChartRange,
  type TrendChartData,
  type TrendConfig,
  type TrendEquity,
} from "@bcr/quant-core/trend";
import {
  CandlestickSeries,
  LineSeries,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type LogicalRange,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef, useState } from "react";
import { priceDigits } from "./format";

const time = (ms: number) => (Math.floor(ms / MINUTE) * 60) as UTCTimestamp;
interface CandleChart {
  kind: "candles";
  chart: IChartApi;
  candles: ISeriesApi<"Candlestick">;
  fast: ISeriesApi<"Line">;
  slow: ISeriesApi<"Line">;
  stops: ISeriesApi<"Line">;
  markers: ISeriesMarkersPluginApi<Time>;
  data: TrendChartData | null;
  focusRevision: number | undefined;
  applying: boolean;
  changed: (range: LogicalRange | null) => void;
}
interface EquityChart {
  kind: "equity";
  chart: IChartApi;
  line: ISeriesApi<"Line">;
}
function logicalTime(range: LogicalRange, data: TrendChartData): ChartRange {
  const step = data.minutes * MINUTE;
  return {
    from: data.from + Number(range.from) * step,
    to: data.from + (Number(range.to) + 1) * step,
  };
}
export function TrendChart({
  data,
  equity,
  config,
  bounds,
  focus,
  onVisible,
}: {
  data?: TrendChartData | null;
  equity?: TrendEquity[];
  config: TrendConfig;
  bounds?: ChartRange;
  focus?: ChartFocus;
  onVisible?: (range: ChartRange) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const instance = useRef<CandleChart | EquityChart | null>(null);
  const controls = useRef({ bounds, focus, onVisible });
  controls.current = { bounds, focus, onVisible };
  const isEquity = equity !== undefined;
  const [theme, setTheme] = useState(0);
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme((value) => value + 1));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "style"],
    });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const css = getComputedStyle(el);
    const accent = css.getPropertyValue("--color-accent").trim() || "#1b8275";
    const muted = css.getPropertyValue("--color-muted").trim() || "#7e8993";
    const danger = css.getPropertyValue("--color-danger").trim() || "#d86167";
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { color: "transparent" },
        textColor: muted,
        fontFamily: css.fontFamily,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: css.getPropertyValue("--color-border").trim() || "#ddd" },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderVisible: false,
        shiftVisibleRangeOnNewBar: false,
        minBarSpacing: 0.1,
      },
      rightPriceScale: { borderVisible: false },
      localization: {
        timeFormatter: (value: number) =>
          new Date(value * 1000).toISOString().slice(0, 16).replace("T", " "),
      },
    });
    if (isEquity) {
      instance.current = {
        kind: "equity",
        chart,
        line: chart.addSeries(LineSeries, {
          color: accent,
          lineWidth: 2,
          priceFormat: { type: "price", precision: 3, minMove: 0.001 },
        }),
      };
    } else {
      const candles = chart.addSeries(CandlestickSeries, {
        priceFormat: {
          type: "price",
          precision: priceDigits(config.tickSize),
          minMove: config.tickSize,
        },
        upColor: accent,
        downColor: danger,
        borderVisible: false,
        wickUpColor: accent,
        wickDownColor: danger,
      });
      const line = (color: string) =>
        chart.addSeries(LineSeries, {
          color,
          lineWidth: 1,
          lastValueVisible: false,
          priceLineVisible: false,
        });
      const model: CandleChart = {
        kind: "candles",
        chart,
        candles,
        fast: line(accent),
        slow: line(muted),
        stops: line(danger),
        markers: createSeriesMarkers(candles, []),
        data: null,
        focusRevision: undefined,
        applying: false,
        changed: () => undefined,
      };
      model.stops.applyOptions({ lineStyle: 2 });
      model.changed = (range) => {
        if (!range || !model.data || model.applying) return;
        const available = controls.current.bounds;
        if (!available) return;
        const raw = logicalTime(range, model.data);
        const visible = clipChartRange(available, raw, config.tradeMinutes);
        if (Math.abs(raw.from - visible.from) > 1 || Math.abs(raw.to - visible.to) > 1) {
          model.applying = true;
          chart.timeScale().setVisibleLogicalRange({
            from: (visible.from - model.data.from) / (model.data.minutes * MINUTE),
            to: (visible.to - model.data.from) / (model.data.minutes * MINUTE) - 1,
          });
          model.applying = false;
        }
        el.dataset.visibleFrom = String(Math.round(visible.from));
        el.dataset.visibleTo = String(Math.round(visible.to));
        controls.current.onVisible?.(visible);
      };
      chart.timeScale().subscribeVisibleLogicalRangeChange(model.changed);
      instance.current = model;
    }
    return () => {
      if (instance.current?.kind === "candles")
        chart.timeScale().unsubscribeVisibleLogicalRangeChange(instance.current.changed);
      instance.current = null;
      chart.remove();
    };
  }, [config, isEquity, theme]);
  useEffect(() => {
    const model = instance.current;
    if (!model) return;
    if (model.kind === "equity") {
      const byTime = new Map<number, number>();
      for (const point of equity ?? [])
        byTime.set(time(point.time), point.equity / config.initialCapital);
      model.line.setData(
        [...byTime]
          .sort((a, b) => a[0] - b[0])
          .map(([t, value]) => ({ time: t as UTCTimestamp, value })),
      );
      model.chart.timeScale().fitContent();
      return;
    }
    if (!data || !data.bars.length) return;
    const pendingFocus = focus && model.focusRevision !== focus.revision;
    const focusAvailable = focus && focus.from >= data.from && focus.to <= data.to;
    if (model.data === data && pendingFocus && !focusAvailable) return;
    const oldRange = model.chart.timeScale().getVisibleLogicalRange();
    const visible =
      pendingFocus && focusAvailable
        ? focus
        : oldRange && model.data
          ? logicalTime(oldRange, model.data)
          : { from: data.from, to: data.to };
    const css = getComputedStyle(root.current!);
    const accent = css.getPropertyValue("--color-accent").trim() || "#1b8275";
    const muted = css.getPropertyValue("--color-muted").trim() || "#7e8993";
    model.applying = true;
    model.candles.setData(data.bars.map((b) => ({ ...b, time: time(b.time) })));
    for (const key of ["fast", "slow"] as const)
      model[key].setData(data.indicators.map((p) => ({ time: time(p.time), value: p[key] })));
    model.stops.setData(
      data.stops.map((p) =>
        p.value === undefined ? { time: time(p.time) } : { time: time(p.time), value: p.value },
      ),
    );
    model.markers.setMarkers(
      data.markers.map((e) => ({
        time: time(e.time),
        position: e.side === "long" ? "belowBar" : "aboveBar",
        color: e.kind === "entry" ? accent : muted,
        shape: e.kind === "entry" ? (e.side === "long" ? "arrowUp" : "arrowDown") : "circle",
        text:
          (e.kind === "entry" ? (e.side === "long" ? "多" : "空") : "平") +
          (e.count > 1 ? ` ×${e.count}` : ""),
      })),
    );
    model.data = data;
    if (pendingFocus && focusAvailable) model.focusRevision = focus.revision;
    const step = data.minutes * MINUTE;
    model.chart.timeScale().setVisibleLogicalRange({
      from: (visible.from - data.from) / step,
      to: (visible.to - data.from) / step - 1,
    });
    model.applying = false;
    model.changed(model.chart.timeScale().getVisibleLogicalRange());
  }, [data, equity, config, focus, isEquity, theme]);
  return (
    <div
      ref={root}
      className="trend-chart"
      data-loaded-from={data?.from}
      data-loaded-to={data?.to}
      data-display-minutes={data?.minutes}
      data-candle-count={data?.bars.length}
      aria-label={isEquity ? "组合净值图" : `${periodLabel(config.tradeMinutes)} K 线与交易标记`}
    />
  );
}
