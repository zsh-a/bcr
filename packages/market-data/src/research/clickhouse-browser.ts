import {
  probeConnection,
  type ClickHouseConnection,
  type ClickHouseInfo,
  type ClickHouseProgress,
  type ClickHouseRange,
} from "./clickhouse-http";
import type { ResearchDataset } from "./model";
import type { ResearchManifest } from "./model";
import type { BenchmarkSnapshot } from "./benchmark";

export interface ClickHouseLoadResult {
  dataset: ResearchDataset;
  cached: boolean;
}
export type ClickHouseWorkerRequest =
  | { type: "inspect"; connection: ClickHouseConnection }
  | { type: "load"; connection: ClickHouseConnection; range: ClickHouseRange }
  | {
      type: "benchmark";
      connection: ClickHouseConnection;
      code: string;
      manifest: ResearchManifest;
    }
  | { type: "cancel" }
  | { type: "connected" }
  | { type: "connection-error"; message: string };
export type ClickHouseWorkerResponse =
  | { type: "connect" }
  | { type: "progress"; value: ClickHouseProgress }
  | { type: "inspected"; value: ClickHouseInfo }
  | { type: "loaded"; value: ClickHouseLoadResult }
  | { type: "benchmark-loaded"; value: BenchmarkSnapshot }
  | { type: "error"; message: string; cancelled: boolean };

/** Credentials travel through ephemeral messages, outside the persisted scheduler/DAG. */
function dataWorker(
  request: Extract<ClickHouseWorkerRequest, { connection: ClickHouseConnection }>,
  signal: AbortSignal,
  progress: (value: ClickHouseProgress) => void,
): Promise<ClickHouseInfo | ClickHouseLoadResult | BenchmarkSnapshot> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../workers/clickhouse.worker.ts", import.meta.url), {
      type: "module",
    });
    const cancel = () => worker.postMessage({ type: "cancel" } satisfies ClickHouseWorkerRequest);
    const cleanup = () => {
      signal.removeEventListener("abort", cancel);
      worker.terminate();
    };
    signal.addEventListener("abort", cancel, { once: true });
    worker.onerror = (event) => {
      event.preventDefault();
      cleanup();
      reject(new Error("ClickHouse 数据 Worker 启动失败，请重新加载页面"));
    };
    worker.onmessage = (event: MessageEvent<ClickHouseWorkerResponse>) => {
      const response = event.data;
      if (response.type === "progress") {
        progress(response.value);
        return;
      }
      if (response.type === "connect") {
        // A Window request can show the local-network permission prompt before Worker queries.
        void probeConnection(request.connection, signal).then(
          () => worker.postMessage({ type: "connected" } satisfies ClickHouseWorkerRequest),
          (error: unknown) =>
            worker.postMessage({
              type: "connection-error",
              message: error instanceof Error ? error.message : String(error),
            } satisfies ClickHouseWorkerRequest),
        );
        return;
      }
      cleanup();
      if (response.type === "error") {
        reject(
          response.cancelled
            ? new DOMException("数据加载已取消", "AbortError")
            : new Error(response.message),
        );
      } else if (signal.aborted) {
        reject(new DOMException("数据加载已取消", "AbortError"));
      } else resolve(response.value);
    };
    worker.postMessage(request);
  });
}
export function inspectFromBrowser(
  connection: ClickHouseConnection,
  signal: AbortSignal,
): Promise<ClickHouseInfo> {
  return dataWorker(
    { type: "inspect", connection },
    signal,
    () => undefined,
  ) as Promise<ClickHouseInfo>;
}
export function loadFromBrowser(
  connection: ClickHouseConnection,
  range: ClickHouseRange,
  signal: AbortSignal,
  progress: (value: ClickHouseProgress) => void,
): Promise<ClickHouseLoadResult> {
  return dataWorker(
    { type: "load", connection, range },
    signal,
    progress,
  ) as Promise<ClickHouseLoadResult>;
}
export function benchmarkFromBrowser(
  connection: ClickHouseConnection,
  code: string,
  manifest: ResearchManifest,
  signal: AbortSignal,
): Promise<BenchmarkSnapshot> {
  return dataWorker(
    { type: "benchmark", connection, code, manifest },
    signal,
    () => undefined,
  ) as Promise<BenchmarkSnapshot>;
}
