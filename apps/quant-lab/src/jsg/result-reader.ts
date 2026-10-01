import type { RuntimeServices } from "@bcr/core";
import type { JsgResult } from "./model";
import type { OrderFilter, ResultSource } from "./result-data";
export type ResultRequest =
  | { id: number; type: "orders"; result: ResultSource; filter: OrderFilter; offset: number }
  | { id: number; type: "curve"; result: ResultSource; from: string; to: string }
  | { id: number; type: "decision"; result: ResultSource; date: string }
  | { id: number; type: "cancel" }
  | { id: number; type: "clear" };
export type ResultResponse = { id: number; value?: unknown; error?: string; cancelled?: boolean };
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
  return result.chunks ? { chunks: result.chunks, equity: [], orders: [], decisions: [] } : result;
}
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
