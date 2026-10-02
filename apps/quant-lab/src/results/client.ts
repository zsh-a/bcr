import type { RuntimeServices } from "@bcr/core";
import type { BenchmarkBinding } from "@bcr/market-data/research/benchmark";
import type { ResearchDataset, SnapshotPartitionRange } from "@bcr/market-data/research/model";
import type { SnapshotBar } from "@bcr/market-data/research/snapshot-reader";
import type { DayEvent, FillMarker, IdentifiedOrder, JsgResult } from "@bcr/quant-core";
import type { ResearchDay } from "@bcr/quant-core/research-model";
import type { Evaluation } from "./evaluation";
import type { ResultRequest, ResultResponse } from "./protocol";
import type { ResearchDayPage, ResearchSummary } from "./research-analysis";
import type { OrderFilter, ResultSource } from "./result-data";

let worker: Worker | undefined;
let sequence = 0;
const pending = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (error: Error) => void; clean: () => void }
>();
function reader() {
  if (worker) return worker;
  worker = new Worker(new URL("../workers/result.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (event: MessageEvent<ResultResponse>) => {
    const result = event.data;
    const request = pending.get(result.id);
    if (!request) return;
    pending.delete(result.id);
    request.clean();
    if (result.error)
      request.reject(
        result.cancelled ? new DOMException("查询已取消", "AbortError") : new Error(result.error),
      );
    else request.resolve(result.value);
  };
  worker.onerror = (event) => {
    event.preventDefault();
    disposeResultReader(new Error(event.message || "结果查询 Worker 启动失败"));
  };
  return worker;
}
function request<T>(message: ResultRequest, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  const target = reader();
  return new Promise<T>((resolve, reject) => {
    const cancel = () => {
      target.postMessage({ id: message.id, type: "cancel" } satisfies ResultRequest);
      pending.delete(message.id);
      signal.removeEventListener("abort", cancel);
      reject(new DOMException("查询已取消", "AbortError"));
    };
    pending.set(message.id, {
      resolve: (value) => resolve(value as T),
      reject,
      clean: () => signal.removeEventListener("abort", cancel),
    });
    signal.addEventListener("abort", cancel, { once: true });
    target.postMessage(message);
  });
}
function source(result: JsgResult): ResultSource {
  return result.chunks
    ? {
        chunks: result.chunks,
        ...(result.diagnostics ? { diagnostics: result.diagnostics } : {}),
        equity: [],
        orders: [],
        decisions: [],
      }
    : result;
}
export const queryResearchSummary = (result: JsgResult, capital: number, signal: AbortSignal) =>
  request<ResearchSummary>(
    { id: ++sequence, type: "research-summary", result: source(result), capital },
    signal,
  );
export const queryResearchDay = (
  result: JsgResult,
  date: string,
  offset: number,
  signal: AbortSignal,
) =>
  request<ResearchDayPage | null>(
    { id: ++sequence, type: "research-day", result: source(result), date, offset },
    signal,
  );
export const queryBreadthHistory = (
  result: JsgResult,
  from: string,
  to: string,
  signal: AbortSignal,
) =>
  request<Pick<ResearchDay, "date" | "breadth">[]>(
    { id: ++sequence, type: "breadth-history", result: source(result), from, to },
    signal,
  );
export function clearResultCache() {
  worker?.postMessage({ id: ++sequence, type: "clear" } satisfies ResultRequest);
}
export function disposeResultReader(
  error: Error = new DOMException("结果查询已结束", "AbortError"),
) {
  worker?.terminate();
  worker = undefined;
  for (const request of pending.values()) {
    request.clean();
    request.reject(error);
  }
  pending.clear();
}
export const queryOrders = (
  _services: RuntimeServices,
  result: JsgResult,
  filter: OrderFilter,
  offset: number,
  signal: AbortSignal,
) =>
  request<{ rows: JsgResult["orders"]; count: number }>(
    { id: ++sequence, type: "orders", result: source(result), filter, offset },
    signal,
  );
export const queryCurve = (
  _services: RuntimeServices,
  result: JsgResult,
  from: string,
  to: string,
  signal: AbortSignal,
) =>
  request<JsgResult["equity"]>(
    { id: ++sequence, type: "curve", result: source(result), from, to },
    signal,
  );
export const queryDecision = (
  _services: RuntimeServices,
  result: JsgResult,
  date: string,
  signal: AbortSignal,
) =>
  request<JsgResult["decisions"][number] | undefined>(
    { id: ++sequence, type: "decision", result: source(result), date },
    signal,
  );
export const queryEvaluation = (
  result: JsgResult,
  capital: number,
  dates: string[],
  baselineDate: string,
  benchmark: BenchmarkBinding | undefined,
  signal: AbortSignal,
) =>
  request<Evaluation>(
    {
      id: ++sequence,
      type: "evaluation",
      result: source(result),
      capital,
      dates,
      baselineDate,
      ...(benchmark ? { benchmark } : {}),
    },
    signal,
  );

export const queryChartEvents = (
  result: JsgResult,
  from: string,
  to: string,
  signal: AbortSignal,
) =>
  request<DayEvent[]>(
    { id: ++sequence, type: "chart-events", result: source(result), from, to },
    signal,
  );
export const queryChartOrders = (
  result: JsgResult,
  from: string,
  to: string,
  code: string,
  offset: number,
  signal: AbortSignal,
) =>
  request<{ rows: IdentifiedOrder[]; count: number }>(
    { id: ++sequence, type: "chart-orders", result: source(result), from, to, code, offset },
    signal,
  );
export const queryChartFills = (
  result: JsgResult,
  from: string,
  to: string,
  code: string,
  signal: AbortSignal,
) =>
  request<FillMarker[]>(
    { id: ++sequence, type: "chart-fills", result: source(result), from, to, code },
    signal,
  );
export const querySnapshotBars = (
  dataset: ResearchDataset,
  code: string,
  from: number,
  to: number,
  signal: AbortSignal,
  ranges?: SnapshotPartitionRange[],
) =>
  request<SnapshotBar[]>(
    {
      id: ++sequence,
      type: "snapshot-bars",
      dataset,
      code,
      from,
      to,
      ...(ranges ? { ranges } : {}),
    },
    signal,
  );
