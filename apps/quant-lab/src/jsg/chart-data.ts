import {
  emptyDayEvent,
  accumulateFill,
  type FillMarker,
  type DayEvent,
  type IdentifiedOrder,
} from "@bcr/quant-core";
import { chunkData, type ResultSource, type ResultStorage } from "./result-data";

/** Stable source positions survive filtering, pagination and repeated queries. */
export async function* chartChunks(
  storage: ResultStorage,
  source: ResultSource,
  from: string,
  to: string,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  if (!source.chunks) {
    yield { key: "inline", data: source };
    return;
  }
  for (const chunk of source.chunks) {
    signal.throwIfAborted();
    if (chunk.end < from || chunk.start > to) continue;
    const data = await chunkData(storage, chunk.ref, signal);
    signal.throwIfAborted();
    yield { key: `${chunk.ref.id}:${chunk.ref.hash ?? ""}`, data };
  }
}
export async function chartEvents(
  storage: ResultStorage,
  source: ResultSource,
  from: string,
  to: string,
  signal: AbortSignal,
): Promise<DayEvent[]> {
  const days = new Map<string, DayEvent>();
  const day = (date: string) => {
    let value = days.get(date);
    if (!value) {
      value = emptyDayEvent(date);
      days.set(date, value);
    }
    return value;
  };
  for await (const { data } of chartChunks(storage, source, from, to, signal)) {
    for (const order of data.orders) {
      if (order.date < from || order.date > to) continue;
      const event = day(order.date);
      if (order.quantity > 0) {
        if (order.side === "buy") event.buys++;
        else event.sells++;
        event.partial += Number(order.status === "partial");
        event.amount += order.price * order.quantity;
        event.fees += order.fee;
        event.rebalances += Number(order.reason === "rebalance");
        for (const reason of [order.reason, order.riskReason])
          if (reason && reason !== "rebalance" && !event.reasons.includes(reason))
            event.reasons.push(reason);
      } else event.rejected++;
    }
    for (const decision of data.decisions) {
      if (decision.date < from || decision.date > to) continue;
      const event = day(decision.date);
      event.signal = true;
      event.targets = decision.targets.length;
    }
    for (const research of data.research ?? [])
      if (
        research.date >= from &&
        research.date <= to &&
        research.candidates?.some((c) => c.reason === "portfolio-stop")
      )
        day(research.date).blocked = true;
    for (const point of data.equity) {
      // These exact closing values anchor annotations, independently of curve downsampling.
      const event = days.get(point.date);
      if (event)
        Object.assign(event, {
          equity: point.equity,
          cash: point.cash,
          drawdown: point.drawdown,
          holdings: point.holdings,
        });
    }
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}
export async function chartOrders(
  storage: ResultStorage,
  source: ResultSource,
  from: string,
  to: string,
  code: string,
  offset: number,
  signal: AbortSignal,
) {
  const rows: IdentifiedOrder[] = [];
  let count = 0;
  for await (const { key, data } of chartChunks(storage, source, from, to, signal)) {
    for (const [i, order] of data.orders.entries()) {
      if (order.date < from || order.date > to || (code && order.code !== code)) continue;
      if (count >= offset && rows.length < 50) rows.push({ ...order, id: `${key}:${i}` });
      count++;
    }
  }
  return { rows, count };
}
export async function chartFills(
  storage: ResultStorage,
  source: ResultSource,
  from: string,
  to: string,
  code: string,
  signal: AbortSignal,
) {
  // One representative per day/side; retain totals and weighted execution prices.
  const groups = new Map<string, FillMarker>();
  for await (const { key, data } of chartChunks(storage, source, from, to, signal)) {
    for (const [i, order] of data.orders.entries()) {
      if (order.date < from || order.date > to || order.code !== code || order.quantity <= 0)
        continue;
      accumulateFill(groups, { ...order, id: `${key}:${i}` });
    }
  }
  return [...groups.values()].sort((a, b) => a.date.localeCompare(b.date));
}
