import { OpfsStore } from "@bcr/storage-opfs";
import { clickHouseClient } from "../research/clickhouse-http";
import { inspectClickHouse, loadClickHouse } from "../research/clickhouse-load";
import { fetchBenchmark } from "../research/benchmark";
import type {
  ClickHouseWorkerRequest,
  ClickHouseWorkerResponse,
} from "../research/clickhouse-browser";

const scope = globalThis as unknown as {
  postMessage(message: ClickHouseWorkerResponse): void;
  onmessage: ((event: MessageEvent<ClickHouseWorkerRequest>) => void) | null;
};
const controller = new AbortController();
let connected: { resolve: () => void; reject: (error: Error) => void } | undefined;
let started = false;
let lastProgress = 0,
  lastCompleted = -1;
const requestConnection = () =>
  new Promise<void>((resolve, reject) => {
    connected = { resolve, reject };
    if (controller.signal.aborted) {
      reject(new Error("cancelled"));
      return;
    }
    scope.postMessage({ type: "connect" });
  });
scope.onmessage = (event) => {
  const request = event.data;
  if (request.type === "cancel") {
    controller.abort();
    connected?.reject(new Error("cancelled"));
    return;
  }
  if (request.type === "connected") {
    connected?.resolve();
    connected = undefined;
    return;
  }
  if (request.type === "connection-error") {
    connected?.reject(new Error(request.message));
    connected = undefined;
    return;
  }
  if (started) return;
  started = true;
  void (async () => {
    try {
      if (request.type === "inspect") {
        await requestConnection();
        const value = await inspectClickHouse(
          clickHouseClient(request.connection),
          controller.signal,
        );
        scope.postMessage({ type: "inspected", value });
      } else if (request.type === "benchmark") {
        await requestConnection();
        const value = await fetchBenchmark(
          request.connection,
          request.code,
          request.manifest,
          controller.signal,
        );
        scope.postMessage({ type: "benchmark-loaded", value });
      } else {
        const value = await loadClickHouse(
          request.connection,
          request.range,
          new OpfsStore("quant"),
          controller.signal,
          (progress) => {
            const now = performance.now();
            if (
              progress.completed !== lastCompleted ||
              now - lastProgress >= 100 ||
              progress.completed === progress.total
            ) {
              lastProgress = now;
              lastCompleted = progress.completed;
              scope.postMessage({ type: "progress", value: progress });
            }
          },
          fetch,
          requestConnection,
        );
        scope.postMessage({ type: "loaded", value });
      }
    } catch (error) {
      scope.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
        cancelled: controller.signal.aborted,
      });
    }
  })();
};
