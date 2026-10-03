import { describe, expect, it } from "vitest";
import { DAY, MINUTE } from "@bcr/market-data/binance/model";
import {
  MAX_TREND_CHART_BARS,
  MAX_TREND_CHART_EVENTS,
  TrendChartProjection,
  canReuseChartWindow,
  initialChartRange,
  planTrendChart,
  type TrendChunk,
  type TrendEvent,
} from "../src/trend";
const base = Date.UTC(2024, 0, 1);
const empty = (): TrendChunk => ({ events: [], indicators: [], trades: [], equity: [] });
const event = (
  time: number,
  kind: TrendEvent["kind"],
  price: number,
  tradeId: number | null = 1,
): TrendEvent => ({
  time,
  kind,
  price,
  side: "long",
  value: null,
  tradeId,
  reason: "test",
});
const bars = (count: number, minutes = 1) =>
  Array.from({ length: count }, (_, i) => ({
    time: base + i * minutes * MINUTE,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1,
  }));
describe("continuous trend chart", () => {
  it("carries optional KDJ and slow EMA across chunks without inventing fast EMA or changing a stop on stage events", () => {
    const projection = new TrendChartProjection(
      { from: base, to: base + 3 * MINUTE, minutes: 1 },
      bars(3),
      { tradeId: 1, value: 95 },
      { time: base - 1, slow: 99, k: 18, d: 20, j: 14 },
    );
    projection.append({
      ...empty(),
      events: [
        {
          ...event(base + MINUTE, "stage", 102),
          reason: "trailing-armed",
          value: 2,
        },
      ],
    });
    projection.append({
      ...empty(),
      indicators: [{ time: base + MINUTE, slow: 100, k: 24, d: 22, j: 28 }],
    });
    const data = projection.finish();
    expect(data.indicators).toEqual([
      { time: base, slow: 99, k: 18, d: 20, j: 14 },
      { time: base + MINUTE, slow: 100, k: 24, d: 22, j: 28 },
      { time: base + 2 * MINUTE, slow: 100, k: 24, d: 22, j: 28 },
    ]);
    expect(data.stops).toEqual([
      { tradeId: 1, points: bars(3).map((bar) => ({ time: bar.time, value: 95 })) },
    ]);
    expect(data.events[0]).toMatchObject({ kind: "stage", value: 2, reason: "trailing-armed" });
    expect(data.markers).toEqual([]);
  });
  it("keeps initial views near the latest candle and expands across day boundaries", () => {
    const bounds = { from: base, to: base + 3 * DAY };
    const initial = initialChartRange(bounds, 1);
    expect(initial.to).toBe(bounds.to);
    expect(initial.to - initial.from).toBe(300 * MINUTE);
    const crossing = planTrendChart(
      bounds,
      { from: base + DAY - 60 * MINUTE, to: base + DAY + 60 * MINUTE },
      1,
    );
    expect(crossing.from).toBeLessThan(base + DAY);
    expect(crossing.to).toBeGreaterThan(base + DAY);
    expect(crossing.minutes).toBe(1);
  });
  it("bounds full-history rendering and respects the strategy's period boundaries", () => {
    const bounds = { from: base, to: base + 730 * DAY };
    for (const period of [1, 3, 5, 15, 30, 60, 120, 240, 1440]) {
      const plan = planTrendChart(bounds, bounds, period);
      expect((plan.to - plan.from) / (plan.minutes * MINUTE)).toBeLessThanOrEqual(
        MAX_TREND_CHART_BARS,
      );
      expect(plan.minutes % period).toBe(0);
      expect(plan.from).toBe(bounds.from);
      expect(plan.to).toBe(bounds.to);
    }
  });
  it("reuses a buffered window until panning reaches an edge or zoom changes granularity", () => {
    const bounds = { from: base, to: base + 10 * DAY };
    const visible = { from: base + DAY, to: base + DAY + 300 * MINUTE };
    const data = planTrendChart(bounds, visible, 1);
    const shifted = { from: visible.from + 50 * MINUTE, to: visible.to + 50 * MINUTE };
    expect(canReuseChartWindow(data, shifted, planTrendChart(bounds, shifted, 1), bounds)).toBe(
      true,
    );
    expect(canReuseChartWindow(data, bounds, planTrendChart(bounds, bounds, 1), bounds)).toBe(
      false,
    );
  });
  it("carries indicators and samples the stop active at candle open without retroactive amendments", () => {
    const projection = new TrendChartProjection(
      { from: base, to: base + 15 * MINUTE, minutes: 5 },
      bars(3, 5),
      { tradeId: 1, value: 90 },
      { time: base - 1, fast: 99, slow: 98 },
    );
    projection.append({
      ...empty(),
      events: [event(base + MINUTE - 1, "stop", 95), event(base + 7 * MINUTE, "exit", 105)],
      indicators: [{ time: base + 4 * MINUTE - 1, fast: 101, slow: 100 }],
    });
    const data = projection.finish();
    expect(data.stops).toEqual([
      {
        tradeId: 1,
        points: [
          { time: base, value: 90 },
          { time: base + 5 * MINUTE, value: 95 },
        ],
      },
    ]);
    expect(data.indicators.map((p) => p.fast)).toEqual([101, 101, 101]);
    expect(data.markers[0]?.time).toBe(base + 5 * MINUTE);
  });
  it("emits no stop segments while flat and separates positions across flat candles", () => {
    const window = { from: base, to: base + 6 * MINUTE, minutes: 1 };
    expect(new TrendChartProjection(window, bars(6)).finish().stops).toEqual([]);
    const projection = new TrendChartProjection(window, bars(6));
    projection.append({
      ...empty(),
      events: [
        event(base, "entry", 100, 1),
        event(base, "stop", 90, 1),
        event(base + 2 * MINUTE, "exit", 101, 1),
        event(base + 4 * MINUTE, "entry", 100, 2),
        event(base + 4 * MINUTE, "stop", 95, 2),
      ],
    });
    expect(projection.finish().stops).toEqual([
      {
        tradeId: 1,
        points: [
          { time: base, value: 90 },
          { time: base + MINUTE, value: 90 },
        ],
      },
      {
        tradeId: 2,
        points: [
          { time: base + 4 * MINUTE, value: 95 },
          { time: base + 5 * MINUTE, value: 95 },
        ],
      },
    ]);
  });
  it("retains exit/reentry boundaries inside one display candle across event chunks", () => {
    const window = { from: base, to: base + 20 * MINUTE, minutes: 5 };
    const events = [
      event(base + 6 * MINUTE, "exit", 101, 1),
      event(base + 7 * MINUTE, "entry", 100, 2),
      event(base + 7 * MINUTE, "stop", 95, 2),
    ];
    const project = (chunks: TrendEvent[][]) => {
      const projection = new TrendChartProjection(window, bars(4, 5), { tradeId: 1, value: 90 });
      for (const events of chunks) projection.append({ ...empty(), events });
      return projection.finish().stops;
    };
    const expected = [
      {
        tradeId: 1,
        points: [
          { time: base, value: 90 },
          { time: base + 5 * MINUTE, value: 90 },
        ],
      },
      {
        tradeId: 2,
        points: [
          { time: base + 10 * MINUTE, value: 95 },
          { time: base + 15 * MINUTE, value: 95 },
        ],
      },
    ];
    expect(project([events])).toEqual(expected);
    expect(project(events.map((e) => [e]))).toEqual(expected);
  });
  it("keeps each sampled segment bounded even when positions open and close between samples", () => {
    const projection = new TrendChartProjection(
      { from: base, to: base + 10 * MINUTE, minutes: 5 },
      bars(2, 5),
      { tradeId: 1, value: 90 },
    );
    projection.append({
      ...empty(),
      events: [
        event(base + MINUTE, "exit", 101, 1),
        event(base + 2 * MINUTE, "entry", 100, 2),
        event(base + 2 * MINUTE, "stop", 94, 2),
        event(base + 3 * MINUTE, "exit", 101, 2),
        event(base + 4 * MINUTE, "entry", 100, 3),
        event(base + 4 * MINUTE, "stop", 95, 3),
      ],
    });
    expect(projection.finish().stops).toEqual([
      { tradeId: 1, points: [{ time: base, value: 90 }] },
      { tradeId: 3, points: [{ time: base + 5 * MINUTE, value: 95 }] },
    ]);
  });
  it("groups overview markers without losing counts and bounds the event preview", () => {
    const projection = new TrendChartProjection(
      { from: base, to: base + DAY, minutes: 1440 },
      bars(1, 1440),
    );
    const events = Array.from({ length: MAX_TREND_CHART_EVENTS + 30 }, (_, i) =>
      event(base + i * MINUTE, i % 2 ? "exit" : "entry", 100),
    );
    for (let i = 0; i < events.length; i += 17)
      projection.append({ ...empty(), events: events.slice(i, i + 17) });
    const data = projection.finish();
    expect(data.markers).toHaveLength(2);
    expect(data.markers.reduce((n, m) => n + m.count, 0)).toBe(events.length);
    expect(data.totalEvents).toBe(events.length);
    expect(data.events).toHaveLength(MAX_TREND_CHART_EVENTS);
    expect(data.events.at(-1)?.time).toBe(events.at(-1)?.time);
  });
});
