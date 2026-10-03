import { MINUTE, type MinuteBar } from "@bcr/market-data/binance/model";
import { TREND_PERIODS } from "./config";
import type { TrendChunk, TrendEvent, TrendIndicator } from "./model";
import type { TrendChannelPoint } from "./channels";

export const MAX_TREND_CHART_BARS = 4096;
export const MAX_TREND_CHART_EVENTS = 200;
export interface ChartRange {
  from: number;
  to: number;
}
export interface TrendChartWindow extends ChartRange {
  minutes: number;
}
export interface ChartFocus extends ChartRange {
  revision: number;
}
export interface TrendChartStop {
  tradeId: number | null;
  value: number;
}
export interface TrendStopSegment {
  tradeId: number | null;
  points: { time: number; value: number }[];
}
export interface TrendChartData extends TrendChartWindow {
  bars: MinuteBar[];
  channels?: TrendChannelPoint[];
  indicators: TrendIndicator[];
  stops: TrendStopSegment[];
  markers: { time: number; kind: "entry" | "exit"; side: "long" | "short"; count: number }[];
  events: TrendEvent[];
  totalEvents: number;
}
export function clipChartRange(bounds: ChartRange, range: ChartRange, minutes: number): ChartRange {
  if (!Number.isFinite(range.from) || !Number.isFinite(range.to) || range.to <= range.from)
    throw new Error("图表可视区间无效");
  const width = Math.min(
    bounds.to - bounds.from,
    Math.max(12 * minutes * MINUTE, range.to - range.from),
  );
  const from = Math.max(bounds.from, Math.min(range.from, bounds.to - width));
  return { from, to: from + width };
}
export function initialChartRange(bounds: ChartRange, minutes: number, focus?: number): ChartRange {
  const width = 300 * minutes * MINUTE;
  return clipChartRange(
    bounds,
    focus === undefined
      ? { from: bounds.to - width, to: bounds.to }
      : { from: focus - width / 2, to: focus + width / 2 },
    minutes,
  );
}
/** Prefetch a screen on either side and coarsen display candles for wide views. */
export function planTrendChart(
  bounds: ChartRange,
  visible: ChartRange,
  tradeMinutes: number,
): TrendChartWindow {
  const range = clipChartRange(bounds, visible, tradeMinutes);
  const width = range.to - range.from;
  const left = Math.max(bounds.from, range.from - width);
  const right = Math.min(bounds.to, range.to + width);
  for (const minutes of TREND_PERIODS) {
    if (minutes < tradeMinutes || minutes % tradeMinutes !== 0) continue;
    const step = minutes * MINUTE;
    const from = Math.max(bounds.from, Math.floor(left / step) * step);
    const to = Math.min(bounds.to, Math.ceil(right / step) * step);
    if ((to - from) / step <= MAX_TREND_CHART_BARS) return { from, to, minutes };
  }
  throw new Error("图表区间超过支持的数据范围");
}
export function canReuseChartWindow(
  data: TrendChartWindow,
  visible: ChartRange,
  next: TrendChartWindow,
  bounds: ChartRange,
): boolean {
  const margin = (visible.to - visible.from) / 4;
  return (
    data.minutes === next.minutes &&
    data.from <= Math.max(bounds.from, visible.from - margin) &&
    data.to >= Math.min(bounds.to, visible.to + margin)
  );
}

/** Stream overlays into a bounded projection. Full events remain in result artifacts. */
export class TrendChartProjection {
  private stop: TrendChartStop | undefined;
  private stopSegment: TrendStopSegment | undefined;
  private previous: TrendIndicator | undefined;
  private cursor = 0;
  private readonly indicators = new Map<number, TrendIndicator>();
  private readonly markers = new Map<string, TrendChartData["markers"][number]>();
  private readonly stops: TrendChartData["stops"] = [];
  private readonly events: TrendEvent[] = [];
  private totalEvents = 0;
  constructor(
    private readonly window: TrendChartWindow,
    private readonly bars: MinuteBar[],
    stop?: TrendChartStop,
    previous?: TrendIndicator,
  ) {
    this.stop = stop;
    this.previous = previous;
  }
  private sampleStop(time: number): void {
    if (!this.stop) return;
    if (!this.stopSegment) {
      this.stopSegment = { tradeId: this.stop.tradeId, points: [] };
      this.stops.push(this.stopSegment);
    }
    this.stopSegment.points.push({ time, value: this.stop.value });
  }
  append(chunk: TrendChunk): void {
    const { from, to, minutes } = this.window;
    const step = minutes * MINUTE;
    for (const e of [...chunk.events].sort((a, b) => a.time - b.time)) {
      if (e.time < from || e.time >= to) continue;
      if (e.kind === "entry" || e.kind === "stop" || e.kind === "exit") {
        while (this.cursor < this.bars.length && this.bars[this.cursor]!.time < e.time) {
          this.sampleStop(this.bars[this.cursor++]!.time);
        }
        if (e.kind === "stop") {
          if (this.stop?.tradeId !== e.tradeId) this.stopSegment = undefined;
          this.stop = { tradeId: e.tradeId, value: e.price };
        } else {
          // Keep a position boundary even when no display candle falls in the gap.
          this.stop = undefined;
          this.stopSegment = undefined;
        }
      }
      if (e.kind !== "stop") {
        this.totalEvents++;
        this.events.push(e);
        if (this.events.length > MAX_TREND_CHART_EVENTS) this.events.shift();
      }
      if (e.kind === "entry" || e.kind === "exit") {
        const time = Math.floor(e.time / step) * step;
        const key = `${time}:${e.kind}:${e.side}`;
        const marker = this.markers.get(key);
        if (marker) marker.count++;
        else this.markers.set(key, { time, kind: e.kind, side: e.side, count: 1 });
      }
    }
    for (const p of chunk.indicators) {
      if (p.time >= from && p.time < to) this.indicators.set(Math.floor(p.time / step) * step, p);
    }
  }
  finish(): TrendChartData {
    while (this.cursor < this.bars.length) this.sampleStop(this.bars[this.cursor++]!.time);
    const indicators: TrendIndicator[] = [];
    for (const bar of this.bars) {
      this.previous = this.indicators.get(bar.time) ?? this.previous;
      if (this.previous) indicators.push({ ...this.previous, time: bar.time });
    }
    return {
      ...this.window,
      bars: this.bars,
      indicators,
      stops: this.stops,
      markers: [...this.markers.values()].sort((a, b) => a.time - b.time),
      events: this.events,
      totalEvents: this.totalEvents,
    };
  }
}
