import {
  anchorEventPoints,
  emptyDayEvent,
  eventVisible,
  fillMarkers,
  groupEvents,
  priceFactor,
  type IdentifiedOrder,
} from "@bcr/quant-core";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { chartEvents, chartFills, chartOrders } from "../src/results/chart-data";
import type { ResultSource, ResultStorage } from "../src/results/result-data";

const order = (patch: Partial<IdentifiedOrder> = {}): IdentifiedOrder => ({
  id: "buy",
  date: "2024-01-08",
  signalDate: "2024-01-05",
  code: "sz.001001",
  side: "buy",
  timing: "next-open",
  reason: "rebalance",
  quantity: 100,
  requested: 100,
  price: 10,
  fee: 1,
  status: "filled",
  ...patch,
});
const storage: ResultStorage = { artifacts: { get: () => Effect.die("unexpected read") } };
const signal = () => new AbortController().signal;
const source = (): ResultSource => ({
  equity: [
    { date: "2024-01-05", equity: 1000, cash: 1000, drawdown: 0, holdings: 0 },
    { date: "2024-01-08", equity: 1030, cash: 29, drawdown: 0, holdings: 1 },
  ],
  orders: [
    order(),
    order({
      id: "partial",
      side: "sell",
      reason: "stop-loss",
      quantity: 50,
      requested: 100,
      status: "partial",
    }),
    order({ id: "rejected", code: "sz.002002", quantity: 0, fee: 0, status: "limit-up" }),
  ],
  decisions: [{ date: "2024-01-05", topIndustry: "tech", breadth: 60, targets: ["sz.001001"] }],
});
describe("backtest chart facts", () => {
  it("keeps Friday's decision separate from Monday's fills and excludes rejected orders from fill totals", async () => {
    const events = await chartEvents(storage, source(), "2024-01-05", "2024-01-08", signal());
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ date: "2024-01-05", signal: true, buys: 0, equity: 1000 });
    expect(events[1]).toMatchObject({
      date: "2024-01-08",
      signal: false,
      buys: 1,
      sells: 1,
      partial: 1,
      rejected: 1,
      amount: 1500,
      fees: 2,
      reasons: ["stop-loss"],
      equity: 1030,
      holdings: 1,
    });
    expect(events.filter((e) => eventVisible(e, "activity"))).toHaveLength(1);
    expect(events.filter((e) => eventVisible(e, "signals"))).toHaveLength(1);
    expect(events.filter((e) => eventVisible(e, "none"))).toEqual([]);
  });
  it("records a blocked decision only from the engine's audit facts", async () => {
    const result = source();
    result.research = [
      {
        date: "2024-01-05",
        cash: 1000,
        equity: 1000,
        receivables: 0,
        breadth: [],
        ledger: [],
        candidates: [
          {
            code: "sz.001001",
            industry: "tech",
            marketCap: 1,
            rank: 1,
            reason: "portfolio-stop",
            tradable: true,
          },
        ],
      },
    ];
    const events = await chartEvents(storage, result, "2024-01-05", "2024-01-08", signal());
    expect(events[0]?.blocked).toBe(true);
  });
  it("preserves separate directions and uses volume-weighted execution prices", async () => {
    const result = source();
    result.orders.push(order({ id: "second", quantity: 300, price: 12 }));
    const fills = await chartFills(
      storage,
      result,
      "2024-01-05",
      "2024-01-08",
      "sz.001001",
      signal(),
    );
    expect(fills).toHaveLength(2);
    expect(fills.find((f) => f.side === "buy")).toMatchObject({
      price: 11.5,
      quantity: 400,
      count: 2,
    });
    expect(fillMarkers([order({ quantity: 0 }), order({ quantity: 20 })])).toHaveLength(1);
  });
  it("converts fills into the same raw or adjusted axis for both execution models", () => {
    expect(40 * priceFactor("jsg-adjusted-v1", false, 4)).toBe(10);
    expect(40 * priceFactor("jsg-adjusted-v1", true, 4)).toBe(40);
    expect(10 * priceFactor("jsg-raw-v2", false, 4)).toBe(10);
    expect(10 * priceFactor("jsg-raw-v2", true, 4)).toBe(40);
  });
  it("bounds dense marker groups and anchors them on exact original closing values", () => {
    const events = Array.from({ length: 5000 }, (_, i) => ({
      ...emptyDayEvent(String(i).padStart(6, "0")),
      buys: 1,
      amount: 100,
      equity: 1000 + i,
      cash: 10,
      holdings: 1,
    }));
    const groups = groupEvents(events);
    expect(groups.length).toBeLessThanOrEqual(120);
    expect(groups.reduce((n, g) => n + g.days, 0)).toBe(5000);
    expect(groups.reduce((n, g) => n + g.event.amount, 0)).toBe(500_000);
    const curve = anchorEventPoints([], groups);
    expect(curve).toHaveLength(groups.length);
    expect(curve.at(-1)).toMatchObject({ date: "004999", equity: 5999, holdings: 1 });
  });
  it("reads only intersecting result chunks and keeps source IDs stable across filters and pagination", async () => {
    const result = source();
    result.orders = Array.from({ length: 80 }, (_, i) =>
      order({ code: i % 2 ? "sz.001001" : "sz.002002" }),
    );
    const refs = [
      {
        ref: { id: "old", type: "quant/jsg-result", storage: "opfs" as const },
        start: "2023-01-01",
        end: "2023-01-02",
        orders: 10,
      },
      {
        ref: { id: "new", type: "quant/jsg-result", storage: "opfs" as const },
        start: "2024-01-05",
        end: "2024-01-08",
        orders: 80,
      },
    ];
    const reads: string[] = [];
    const disk: ResultStorage = {
      ...storage,
      readChunk: async (ref) => {
        reads.push(ref.id);
        return result;
      },
    };
    const chunked: ResultSource = { chunks: refs, equity: [], decisions: [], orders: [] };
    const all = await chartOrders(disk, chunked, "2024-01-05", "2024-01-08", "", 0, signal());
    const filtered = await chartOrders(
      disk,
      chunked,
      "2024-01-05",
      "2024-01-08",
      "sz.001001",
      0,
      signal(),
    );
    const next = await chartOrders(disk, chunked, "2024-01-05", "2024-01-08", "", 50, signal());
    expect(all.rows).toHaveLength(50);
    expect(all.count).toBe(80);
    expect(next.rows).toHaveLength(30);
    expect(next.rows[0]?.id).toBe("new::50");
    expect(filtered.rows[0]?.id).toBe(all.rows[1]?.id);
    expect(reads).toEqual(["new", "new", "new"]);
    const abort = new AbortController();
    abort.abort();
    await expect(
      chartEvents(disk, chunked, "2024-01-05", "2024-01-08", abort.signal),
    ).rejects.toThrow();
  });
});
