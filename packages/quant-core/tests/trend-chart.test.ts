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
const event = (time: number, kind: TrendEvent["kind"], price: number): TrendEvent => ({
  time,
  kind,
  price,
  side: "long",
  value: null,
  tradeId: 1,
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
      90,
      { time: base - 1, fast: 99, slow: 98 },
    );
    projection.append({
      ...empty(),
      events: [event(base + MINUTE - 1, "stop", 95), event(base + 7 * MINUTE, "exit", 105)],
      indicators: [{ time: base + 4 * MINUTE - 1, fast: 101, slow: 100 }],
    });
    const data = projection.finish();
    expect(data.stops.map((p) => p.value)).toEqual([90, 95, undefined]);
    expect(data.indicators.map((p) => p.fast)).toEqual([101, 101, 101]);
    expect(data.markers[0]?.time).toBe(base + 5 * MINUTE);
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
