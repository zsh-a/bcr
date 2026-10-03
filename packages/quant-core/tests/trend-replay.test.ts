import { describe, expect, it } from "vitest";
import { trendTradeReplay, type TrendEvent, type TrendTrade } from "../src/trend";

const trade = {
  id: 4,
  side: "long",
  entryTime: 10,
  exitTime: 30,
  entryPrice: 100,
  exitPrice: 104,
  initialStop: 98,
  quantity: 2,
  netPnl: 7,
  entrySignal: { time: 9, price: 99, atr: 1, boundary: 98 },
} as TrendTrade;
const event = (
  time: number,
  kind: TrendEvent["kind"],
  price: number,
  reason = "initial",
  tradeId: number | null = 4,
): TrendEvent => ({ time, kind, price, reason, tradeId, value: null, side: "long" });

describe("recorded trade replay", () => {
  it("retains intra-timestamp event order and excludes unrelated or unlinked observations", () => {
    const steps = trendTradeReplay(trade, [
      event(10, "entry", 100),
      event(10, "stop", 98),
      event(20, "stage", 103, "breakeven-armed"),
      event(20, "stop", 100, "breakeven"),
      event(20, "stop", 102, "trailing", 5),
      event(21, "setup", 0, "sp-accepted", null),
      event(30, "exit", 104, "end-range"),
    ]);
    expect(steps.map((step) => step.kind)).toEqual([
      "signal",
      "entry",
      "stop",
      "stage",
      "stop",
      "exit",
    ]);
    expect(steps.map((step) => step.stop)).toEqual([null, 98, 98, 98, 100, null]);
    expect(steps[0]).toMatchObject({
      phase: "confirmed",
      breakEvenArmed: false,
      source: "signal-snapshot",
    });
    expect(steps[3]).toMatchObject({ phase: "open", breakEvenArmed: true, trailingArmed: false });
    expect(steps[5]).toMatchObject({ phase: "closed", breakEvenArmed: true });
    expect(steps[0]).not.toHaveProperty("netPnl");
  });
  it("does not cap a long trade at the chart's 200-event preview", () => {
    expect(
      trendTradeReplay(
        trade,
        Array.from({ length: 250 }, () => event(20, "stop", 100)),
      ),
    ).toHaveLength(253);
  });
  it("labels historical ledger fallbacks, without fabricating a signal or stage activation", () => {
    const old = { ...trade };
    delete old.entrySignal;
    const steps = trendTradeReplay({ ...old, side: "short", initialStop: 102 }, [
      event(20, "stop", 98, "trailing"),
    ]);
    expect(steps.map((step) => step.source)).toEqual(["trade-ledger", "event", "trade-ledger"]);
    expect(steps[0]!.stop).toBe(102);
    expect(steps.every((step) => !step.trailingArmed)).toBe(true);
  });
});
