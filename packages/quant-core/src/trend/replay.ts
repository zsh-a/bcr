import type { TrendEvent, TrendTrade } from "./model";

export interface TrendReplayStep {
  time: number;
  kind: TrendEvent["kind"];
  reason: string;
  price: number;
  value: number | null;
  source: "signal-snapshot" | "event" | "trade-ledger";
  phase: "confirmed" | "open" | "closed";
  stop: number | null;
  breakEvenArmed: boolean;
  trailingArmed: boolean;
}

/** Project recorded evidence only. Equal timestamps retain ledger order, not price order. */
export function trendTradeReplay(
  trade: TrendTrade,
  events: readonly TrendEvent[],
): TrendReplayStep[] {
  const linked = events.filter((event) => event.tradeId === trade.id);
  const rows: Pick<TrendReplayStep, "time" | "kind" | "reason" | "price" | "value" | "source">[] =
    [];
  if (trade.entrySignal) {
    rows.push({
      time: trade.entrySignal.time,
      kind: "signal",
      reason: "signal-confirmed",
      price: trade.entrySignal.price,
      value: null,
      source: "signal-snapshot",
    });
  }
  // Old ledgers can omit events. Endpoints are identified as ledger facts, never invented signals.
  if (!linked.some((event) => event.kind === "entry")) {
    rows.push({
      time: trade.entryTime,
      kind: "entry",
      reason: "entry-filled",
      price: trade.entryPrice,
      value: trade.quantity,
      source: "trade-ledger",
    });
  }
  rows.push(...linked.map((event) => ({ ...event, source: "event" as const })));
  if (!linked.some((event) => event.kind === "exit")) {
    rows.push({
      time: trade.exitTime,
      kind: "exit",
      reason: trade.reason,
      price: trade.exitPrice,
      value: null,
      source: "trade-ledger",
    });
  }
  rows.sort((a, b) => a.time - b.time);
  let phase: TrendReplayStep["phase"] = "confirmed";
  let stop: number | null = null;
  let breakEvenArmed = false,
    trailingArmed = false;
  return rows.map((row) => {
    if (row.kind === "entry") {
      phase = "open";
      stop = trade.initialStop;
    }
    if (row.kind === "stop") stop = row.price;
    if (row.kind === "stage" && row.reason === "breakeven-armed") breakEvenArmed = true;
    if (row.kind === "stage" && row.reason === "trailing-armed") trailingArmed = true;
    if (row.kind === "exit") {
      phase = "closed";
      stop = null;
    }
    return { ...row, phase, stop, breakEvenArmed, trailingArmed };
  });
}
