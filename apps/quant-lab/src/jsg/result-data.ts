import type { ArtifactRef, RuntimeServices } from "@bcr/core";
import { readJson } from "./data";
import type { JsgResult } from "./model";

export type ResultStorage = {
  artifacts: Pick<RuntimeServices["artifacts"], "get">;
  readChunk?: (ref: ArtifactRef, signal: AbortSignal) => Promise<ResultChunk>;
};
export type ResultSource = Pick<
  JsgResult,
  "chunks" | "equity" | "orders" | "decisions" | "research" | "diagnostics"
>;
export const ORDER_PAGE_SIZE = 50;
export interface OrderFilter {
  from: string;
  to: string;
  code: string;
  side: string;
  status: string;
}
export const EMPTY_ORDER_FILTER: OrderFilter = { from: "", to: "", code: "", side: "", status: "" };
export type ResultChunk = Pick<JsgResult, "equity" | "orders" | "decisions" | "research">;
export const chunkData = (services: ResultStorage, ref: ArtifactRef, signal: AbortSignal) =>
  services.readChunk ? services.readChunk(ref, signal) : readJson<ResultChunk>(services, ref);
export async function queryOrders(
  services: ResultStorage,
  result: ResultSource,
  filter: OrderFilter,
  offset: number,
  signal: AbortSignal,
) {
  const rows: JsgResult["orders"] = [];
  let count = 0;
  const accepts = (order: JsgResult["orders"][number]) =>
    (!filter.from || order.date >= filter.from) &&
    (!filter.to || order.date <= filter.to) &&
    (!filter.code || order.code.toLowerCase().includes(filter.code.toLowerCase())) &&
    (!filter.side || order.side === filter.side) &&
    (!filter.status ||
      (filter.status === "filled"
        ? order.quantity > 0
        : filter.status === "rejected"
          ? order.quantity === 0
          : order.status === filter.status));
  const consume = (orders: JsgResult["orders"]) => {
    for (let i = orders.length - 1; i >= 0; i--) {
      const order = orders[i]!;
      if (!accepts(order)) continue;
      if (count >= offset && rows.length < ORDER_PAGE_SIZE) rows.push(order);
      count++;
    }
  };
  signal.throwIfAborted();
  if (result.chunks === undefined) consume(result.orders);
  else
    for (let i = result.chunks.length - 1; i >= 0; i--) {
      signal.throwIfAborted();
      const chunk = result.chunks[i]!;
      if (
        chunk.orders === 0 ||
        (filter.code &&
          chunk.codes &&
          !chunk.codes.some((code) => code.toLowerCase().includes(filter.code.toLowerCase()))) ||
        (filter.from && chunk.end < filter.from) ||
        (filter.to && chunk.start > filter.to)
      )
        continue;
      const entireChunk =
        !filter.code &&
        (!filter.from || filter.from <= chunk.start) &&
        (!filter.to || filter.to >= chunk.end);
      const matching = !entireChunk
        ? undefined
        : !filter.side && !filter.status
          ? chunk.orders
          : chunk.orderStats?.reduce(
              (n, cell) =>
                n +
                ((!filter.side || cell.side === filter.side) &&
                (!filter.status ||
                  (filter.status === "filled"
                    ? cell.filled
                    : filter.status === "rejected"
                      ? !cell.filled
                      : cell.status === filter.status))
                  ? cell.count
                  : 0),
              0,
            );
      if (matching === 0) continue;
      if (
        matching !== undefined &&
        (count + matching <= offset || rows.length >= ORDER_PAGE_SIZE)
      ) {
        count += matching;
        continue;
      }
      const data = await chunkData(services, chunk.ref, signal);
      signal.throwIfAborted();
      consume(data.orders);
    }
  return { rows, count };
}
export async function queryDecision(
  services: ResultStorage,
  result: ResultSource,
  date: string,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  if (result.chunks === undefined) return result.decisions.find((d) => d.date === date);
  const chunk = result.chunks.find((c) => c.start <= date && c.end >= date);
  if (chunk === undefined) return undefined;
  const data = await chunkData(services, chunk.ref, signal);
  signal.throwIfAborted();
  return data.decisions.find((d) => d.date === date);
}

/** Keep extrema in time buckets, retaining at most 4,096 points regardless of history length. */
export async function queryCurve(
  services: ResultStorage,
  result: ResultSource,
  from: string,
  to: string,
  signal: AbortSignal,
): Promise<JsgResult["equity"]> {
  const buckets = new Map<
    number,
    {
      min: JsgResult["equity"][number];
      max: JsgResult["equity"][number];
      drawdown: JsgResult["equity"][number];
      last: JsgResult["equity"][number];
    }
  >();
  const beginning = Date.parse(from),
    span = Math.max(1, Date.parse(to) - beginning);
  let first: JsgResult["equity"][number] | undefined, last: JsgResult["equity"][number] | undefined;
  const consume = (points: JsgResult["equity"]) => {
    for (const point of points) {
      if (point.date < from || point.date > to) continue;
      first ??= point;
      last = point;
      const key = Math.min(
        1022,
        Math.max(0, Math.floor(((Date.parse(point.date) - beginning) / span) * 1023)),
      );
      const value = buckets.get(key);
      if (value === undefined)
        buckets.set(key, { min: point, max: point, drawdown: point, last: point });
      else {
        if (point.equity < value.min.equity) value.min = point;
        if (point.equity > value.max.equity) value.max = point;
        if (point.drawdown < value.drawdown.drawdown) value.drawdown = point;
        value.last = point;
      }
    }
  };
  signal.throwIfAborted();
  if (result.chunks === undefined) consume(result.equity);
  else
    for (const chunk of result.chunks) {
      signal.throwIfAborted();
      if (chunk.end < from || chunk.start > to) continue;
      const data = await chunkData(services, chunk.ref, signal);
      signal.throwIfAborted();
      consume(data.equity);
    }
  const points = new Map<string, JsgResult["equity"][number]>();
  if (first) points.set(first.date, first);
  for (const value of buckets.values())
    for (const point of [value.min, value.max, value.drawdown, value.last])
      points.set(point.date, point);
  if (last) points.set(last.date, last);
  return [...points.values()].sort((a, b) => a.date.localeCompare(b.date));
}
