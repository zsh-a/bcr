import type { JsgResult } from "./model";

export type ResearchOrder = JsgResult["orders"][number];
export type IdentifiedOrder = ResearchOrder & { id: string };
export interface DayEvent {
  date: string;
  equity?: number;
  cash?: number;
  drawdown?: number;
  holdings?: number;
  buys: number;
  sells: number;
  rejected: number;
  partial: number;
  amount: number;
  fees: number;
  rebalances: number;
  reasons: string[];
  signal: boolean;
  blocked: boolean;
  targets: number;
}
export type EventMode = "activity" | "signals" | "all" | "none";
export function emptyDayEvent(date: string): DayEvent {
  return {
    date,
    buys: 0,
    sells: 0,
    rejected: 0,
    partial: 0,
    amount: 0,
    fees: 0,
    rebalances: 0,
    reasons: [],
    signal: false,
    blocked: false,
    targets: 0,
  };
}
export function eventVisible(event: DayEvent, mode: EventMode) {
  return (
    mode === "all" ||
    (mode === "activity" && event.buys + event.sells > 0) ||
    (mode === "signals" && (event.signal || event.blocked))
  );
}
export interface EventGroup {
  from: string;
  to: string;
  days: number;
  event: DayEvent;
}
/** Aggregate dense annotations without moving their representative point to another session. */
export function groupEvents(events: DayEvent[], limit = 120): EventGroup[] {
  const stride = Math.max(1, Math.ceil(events.length / Math.max(1, limit)));
  const groups: EventGroup[] = [];
  for (let i = 0; i < events.length; i += stride) {
    const days = events.slice(i, i + stride);
    const last = days.at(-1)!;
    const event = { ...last, reasons: [...new Set(days.flatMap((d) => d.reasons))] };
    for (const key of [
      "buys",
      "sells",
      "rejected",
      "partial",
      "amount",
      "fees",
      "rebalances",
    ] as const)
      event[key] = days.reduce((n, d) => n + d[key], 0);
    event.signal = days.some((d) => d.signal);
    event.blocked = days.some((d) => d.blocked);
    groups.push({ from: days[0]!.date, to: last.date, days: days.length, event });
  }
  return groups;
}
export function priceFactor(model: string, adjusted: boolean, factor: number) {
  return model === "jsg-raw-v2" ? (adjusted ? factor : 1) : adjusted ? 1 : 1 / factor;
}
export interface FillMarker {
  date: string;
  side: string;
  price: number;
  quantity: number;
  count: number;
  id: string;
}
export function accumulateFill(points: Map<string, FillMarker>, order: IdentifiedOrder) {
  if (order.quantity <= 0) return;
  const key = `${order.date}:${order.side}`;
  const point = points.get(key);
  if (point) {
    point.price =
      (point.price * point.quantity + order.price * order.quantity) /
      (point.quantity + order.quantity);
    point.quantity += order.quantity;
    point.count++;
  } else
    points.set(key, {
      date: order.date,
      side: order.side,
      price: order.price,
      quantity: order.quantity,
      count: 1,
      id: order.id,
    });
}
/** Preserve buys and sells separately, even when they execute on the same day. */
export function fillMarkers(orders: IdentifiedOrder[]): FillMarker[] {
  const points = new Map<string, FillMarker>();
  for (const order of orders) accumulateFill(points, order);
  return [...points.values()].sort((a, b) => a.date.localeCompare(b.date));
}
export function anchorEventPoints(
  points: JsgResult["equity"],
  groups: EventGroup[],
): JsgResult["equity"] {
  const curve = new Map(points.map((p) => [p.date, p]));
  for (const { event } of groups) {
    if (event.equity === undefined) continue;
    curve.set(event.date, {
      date: event.date,
      equity: event.equity,
      cash: event.cash ?? 0,
      drawdown: event.drawdown ?? 0,
      holdings: event.holdings ?? curve.get(event.date)?.holdings ?? 0,
    });
  }
  return [...curve.values()].sort((a, b) => a.date.localeCompare(b.date));
}
