import { dateText } from "@bcr/market-data/research/model";
import type { SnapshotBar } from "@bcr/market-data/research/snapshot-reader";
import { priceFactor, type FillMarker } from "@bcr/quant-core";
import { Button, Select, Spinner } from "@bcr/react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type SeriesMarker,
  type Time,
} from "lightweight-charts";
import { useEffect, useRef, useState } from "react";
import type { SelectedRun } from "../../session/model";
import { queryChartFills, querySnapshotBars } from "../client";
import { money } from "../format";
import { useInspection } from "../inspection/ResearchInspection";
import { chartDate } from "./chart-time";
import { candleWindow } from "./chart-window";

export default function TradeChart({ selected, code }: { selected: SelectedRun; code: string }) {
  const { focus, inspect } = useInspection();
  const container = useRef<HTMLDivElement>(null),
    chartRef = useRef<IChartApi | null>(null);
  const [data, setData] = useState<{ bars: SnapshotBar[]; fills: FillMarker[] }>();
  const [error, setError] = useState("");
  const model = selected.result.metrics.model;
  const [adjusted, setAdjusted] = useState(model !== "jsg-raw-v2");
  const [hover, setHover] = useState<SnapshotBar>();
  const [range, setRange] = useState("focus");
  const window = candleWindow(
    selected.dataset.manifest,
    selected.run.startDate,
    selected.run.endDate,
    focus.date,
    range,
  );
  useEffect(() => {
    const abort = new AbortController();
    setData(undefined);
    setError("");
    setHover(undefined);
    void Promise.all([
      querySnapshotBars(
        selected.dataset,
        code,
        window.from,
        window.to,
        abort.signal,
        selected.result.inputRanges,
      ),
      queryChartFills(
        selected.result,
        dateText(window.from),
        dateText(window.to),
        code,
        abort.signal,
      ),
    ])
      .then(([bars, fills]) => {
        if (!abort.signal.aborted) setData({ bars, fills });
      })
      .catch((e: unknown) => {
        if (!abort.signal.aborted) setError(String(e));
      });
    return () => abort.abort();
  }, [selected, code, window.from, window.to]);
  useEffect(() => {
    if (!container.current || !data?.bars.length) return;
    const chart = createChart(container.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        fontFamily: "IBM Plex Mono, monospace",
        fontSize: 11,
        attributionLogo: false,
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false },
      handleScroll: { vertTouchDrag: false },
    });
    chartRef.current = chart;
    const candles = chart.addSeries(CandlestickSeries, {
      priceLineVisible: false,
      priceFormat: { type: "price", precision: 3, minMove: 0.001 },
    });
    const volume = data.bars.some((bar) => bar.volume !== null)
      ? chart.addSeries(
          HistogramSeries,
          { priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false },
          1,
        )
      : null;
    chart.panes()[0]?.setStretchFactor(4);
    chart.panes()[1]?.setStretchFactor(1);
    const byDate = new Map(data.bars.map((bar) => [bar.date, bar]));
    const plotted = data.bars.map((bar) => {
      const factor = adjusted ? bar.factor : 1;
      return {
        time: bar.date,
        open: bar.open * factor,
        high: bar.high * factor,
        low: bar.low * factor,
        close: bar.close * factor,
      };
    });
    candles.setData(plotted);
    const markers = createSeriesMarkers(candles, []);
    const applyTheme = () => {
      const css = getComputedStyle(container.current!);
      const color = (key: string) => css.getPropertyValue(`--color-${key}`).trim();
      chart.applyOptions({
        layout: { textColor: color("muted"), panes: { separatorColor: color("border") } },
        grid: { vertLines: { visible: false }, horzLines: { color: color("border") } },
      });
      candles.applyOptions({
        upColor: color("success"),
        downColor: color("danger"),
        wickUpColor: color("success"),
        wickDownColor: color("danger"),
        borderVisible: false,
      });
      volume?.setData(
        data.bars
          .filter((bar) => bar.volume !== null)
          .map((bar) => ({
            time: bar.date,
            value: bar.volume!,
            color: bar.close >= bar.open ? color("success") : color("danger"),
          })),
      );
      updateMarkers();
    };
    const updateMarkers = () => {
      const visible = chart.timeScale().getVisibleRange();
      const css = getComputedStyle(container.current!);
      const color = (key: string) => css.getPropertyValue(`--color-${key}`).trim();
      const annotations: SeriesMarker<Time>[] = [];
      for (const side of ["buy", "sell"]) {
        const fills = data.fills.filter(
          (fill) =>
            fill.side === side &&
            byDate.has(fill.date) &&
            (!visible ||
              (fill.date >= chartDate(visible.from) && fill.date <= chartDate(visible.to))),
        );
        const stride = Math.max(1, Math.ceil(fills.length / 80));
        for (let i = 0; i < fills.length; i += stride) {
          const group = fills.slice(i, i + stride);
          const fill = group.at(-1)!;
          const bar = byDate.get(fill.date)!;
          const buy = side === "buy";
          annotations.push({
            time: fill.date,
            price: fill.price * priceFactor(model, adjusted, bar.factor),
            position: buy ? "atPriceBottom" : "atPriceTop",
            shape: buy ? "arrowUp" : "arrowDown",
            color: color(buy ? "success" : "danger"),
            id: fill.date,
            text: `${buy ? "B" : "S"}${group.length > 1 ? `·${group.length}` : ""}`,
          });
        }
      }
      annotations.sort((a, b) => chartDate(a.time).localeCompare(chartDate(b.time)));
      markers.setMarkers(annotations);
      container.current!.dataset["fillMarkerCount"] = String(annotations.length);
    };
    applyTheme();
    chart.timeScale().subscribeVisibleTimeRangeChange(updateMarkers);
    const observer = new MutationObserver(applyTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    chart.subscribeCrosshairMove((event) =>
      setHover(event.time ? byDate.get(chartDate(event.time)) : undefined),
    );
    chart.subscribeClick((event) => {
      if (event.time) inspect({ date: chartDate(event.time), code });
    });
    return () => {
      observer.disconnect();
      markers.detach();
      chart.remove();
      chartRef.current = null;
    };
  }, [data, adjusted, model, code, inspect]);
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !data?.bars.length) return;
    if (range === "all") {
      chart.timeScale().fitContent();
      return;
    }
    const index = Math.max(
      0,
      data.bars.findIndex((b) => b.date >= focus.date),
    );
    const start = range === "focus" ? Math.max(0, index - 35) : Math.max(0, data.bars.length - 252);
    const end =
      range === "focus" ? Math.min(data.bars.length - 1, index + 20) : data.bars.length - 1;
    chart.timeScale().setVisibleLogicalRange({ from: start - 2, to: end + 2 });
  }, [data, adjusted, focus.date, range]);
  const active = hover ?? data?.bars.find((b) => b.date === focus.date) ?? data?.bars.at(-1);
  const scale = adjusted ? (active?.factor ?? 1) : 1;
  return (
    <section className="research-trade-chart" aria-label="回测快照 K 线">
      <div className="research-event-tools">
        <Select
          aria-label="K线价格口径"
          value={adjusted ? "adjusted" : "raw"}
          onChange={(e) => setAdjusted(e.target.value === "adjusted")}
        >
          <option value="raw">原始价格</option>
          <option value="adjusted">快照复权价格</option>
        </Select>
        <div role="group" aria-label="K线查看范围">
          {[
            ["focus", "成交附近"],
            ["year", "1 年"],
            ["all", "全部"],
          ].map(([value, label]) => (
            <Button
              key={value}
              size="sm"
              variant="ghost"
              aria-pressed={range === value}
              onClick={() => setRange(value!)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>
      {error ? (
        <p role="alert" className="research-error">
          {error}
        </p>
      ) : !data ? (
        <p className="research-small-empty">
          <Spinner size="sm" />
          读取回测行情快照…
        </p>
      ) : !data.bars.length ? (
        <p className="research-small-empty">此证券在回测区间内没有行情。</p>
      ) : (
        <>
          <div className="research-candle-readout" aria-live="off">
            <span>{active?.date}</span>
            {active && (
              <>
                <span>开 {money(active.open * scale)}</span>
                <span>高 {money(active.high * scale)}</span>
                <span>低 {money(active.low * scale)}</span>
                <span>收 {money(active.close * scale)}</span>
                {!active.tradable && <span>停牌</span>}
              </>
            )}
          </div>
          <div
            ref={container}
            className="research-trade-canvas"
            role="img"
            aria-label={`${code} 回测快照K线，${data.bars.length} 根日线，${data.fills.length} 组成交标记`}
          />
          <p className="research-help">
            ↑ B 买入 · ↓ S 卖出 ·
            点击日期查看当日订单；同日同方向使用加权成交价；密集区间按成交日聚合，数字表示日数，放大后展开。
          </p>
          {data.fills.some((fill) => !data.bars.some((bar) => bar.date === fill.date)) && (
            <p className="research-help">部分成交日期缺少行情，详情仍保留原始成交记录。</p>
          )}
        </>
      )}
    </section>
  );
}
