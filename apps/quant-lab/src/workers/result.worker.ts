import { artifactPath, type ArtifactRef } from "@bcr/core";
import { readBenchmark } from "@bcr/market-data/research/benchmark";
import { withResearchFiles } from "@bcr/market-data/research/file-lease";
import { readSnapshotBars, type SnapshotBar } from "@bcr/market-data/research/snapshot-reader";
import { marketResearchStore } from "@bcr/market-data/research/storage";
import { Effect } from "effect";
import { chartEvents, chartFills, chartOrders } from "../results/chart-data";
import { evaluateResult } from "../results/evaluation";
import type { ResultRequest, ResultResponse } from "../results/protocol";
import { breadthHistory, researchDay, researchSummary } from "../results/research-analysis";
import { queryCurve, queryDecision, queryOrders, type ResultChunk } from "../results/result-data";

const scope = globalThis as unknown as {
  postMessage: (value: ResultResponse) => void;
  onmessage: (event: MessageEvent<ResultRequest>) => void;
};
const store = marketResearchStore();
const controllers = new Map<number, AbortController>();
const cache = new Map<string, { bytes: number; value: ResultChunk }>();
let cacheBytes = 0;
const candleCache = new Map<string, SnapshotBar[]>();
let candleBytes = 0;
async function snapshotQuery(
  message: Extract<ResultRequest, { type: "snapshot-bars" }>,
  signal: AbortSignal,
) {
  const key = JSON.stringify([
    message.dataset.manifestRef,
    message.dataset.partitions,
    message.code,
    message.from,
    message.to,
    message.ranges,
  ]);
  const existing = candleCache.get(key);
  if (existing) {
    candleCache.delete(key);
    candleCache.set(key, existing);
    return existing;
  }
  const bars = await readSnapshotBars(
    store,
    message.dataset,
    message.code,
    message.from,
    message.to,
    signal,
    message.ranges,
  );
  const size = bars.length * 112;
  while (candleCache.size && (candleBytes + size > 8 * 1024 * 1024 || candleCache.size >= 8)) {
    const oldest = candleCache.keys().next().value!;
    candleBytes -= candleCache.get(oldest)!.length * 112;
    candleCache.delete(oldest);
  }
  if (size <= 8 * 1024 * 1024) {
    candleCache.set(key, bars);
    candleBytes += size;
  }
  return bars;
}
let yieldedAt = 0;
const services = {
  artifacts: {
    get: (ref: ArtifactRef) =>
      Effect.promise(async () => {
        const bytes = await store.get(artifactPath(ref));
        if (!bytes) throw new Error("结果文件已移除，请重新运行回测");
        return bytes;
      }),
  },
  readChunk: async (ref: ArtifactRef, signal: AbortSignal): Promise<ResultChunk> => {
    signal.throwIfAborted();
    if (performance.now() - yieldedAt > 16) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      yieldedAt = performance.now();
    }
    signal.throwIfAborted();
    const key = `${ref.id}:${ref.hash ?? ""}`;
    const existing = cache.get(key);
    if (existing) {
      cache.delete(key);
      cache.set(key, existing);
      return existing.value;
    }
    const size = await store.size(artifactPath(ref));
    if (size === undefined || size > 32 * 1024 * 1024) throw new Error("结果分片缺失或超过 32 MiB");
    const bytes = await Effect.runPromise(services.artifacts.get(ref));
    signal.throwIfAborted();
    const value = JSON.parse(new TextDecoder().decode(bytes)) as ResultChunk;
    if (
      !Array.isArray(value.orders) ||
      !Array.isArray(value.equity) ||
      !Array.isArray(value.decisions)
    )
      throw new Error("结果分片无效");
    if (size <= 8 * 1024 * 1024) {
      while (cache.size && (cacheBytes + size > 8 * 1024 * 1024 || cache.size >= 64)) {
        const oldest = cache.keys().next().value!;
        cacheBytes -= cache.get(oldest)!.bytes;
        cache.delete(oldest);
      }
      cache.set(key, { bytes: size, value });
      cacheBytes = [...cache.values()].reduce((n, entry) => n + entry.bytes, 0);
    }
    return value;
  },
};
scope.onmessage = (event) => {
  const message = event.data;
  if (message.type === "cancel") {
    controllers.get(message.id)?.abort();
    return;
  }
  if (message.type === "clear") {
    cache.clear();
    cacheBytes = 0;
    candleCache.clear();
    candleBytes = 0;
    return;
  }
  const controller = new AbortController();
  controllers.set(message.id, controller);
  void withResearchFiles("shared", async () => {
    try {
      controller.signal.throwIfAborted();
      const value =
        message.type === "snapshot-bars"
          ? await snapshotQuery(message, controller.signal)
          : message.type === "chart-events"
            ? await chartEvents(
                services,
                message.result,
                message.from,
                message.to,
                controller.signal,
              )
            : message.type === "chart-orders"
              ? await chartOrders(
                  services,
                  message.result,
                  message.from,
                  message.to,
                  message.code,
                  message.offset,
                  controller.signal,
                )
              : message.type === "chart-fills"
                ? await chartFills(
                    services,
                    message.result,
                    message.from,
                    message.to,
                    message.code,
                    controller.signal,
                  )
                : message.type === "research-summary"
                  ? await researchSummary(
                      services,
                      message.result,
                      message.capital,
                      controller.signal,
                    )
                  : message.type === "research-day"
                    ? await researchDay(
                        services,
                        message.result,
                        message.date,
                        message.offset,
                        controller.signal,
                      )
                    : message.type === "breadth-history"
                      ? await breadthHistory(
                          services,
                          message.result,
                          message.from,
                          message.to,
                          controller.signal,
                        )
                      : message.type === "evaluation"
                        ? await evaluateResult(
                            services,
                            message.result,
                            message.capital,
                            message.dates,
                            message.baselineDate,
                            message.benchmark
                              ? await readBenchmark(services, message.benchmark)
                              : undefined,
                            controller.signal,
                          )
                        : message.type === "orders"
                          ? await queryOrders(
                              services,
                              message.result,
                              message.filter,
                              message.offset,
                              controller.signal,
                            )
                          : message.type === "curve"
                            ? await queryCurve(
                                services,
                                message.result,
                                message.from,
                                message.to,
                                controller.signal,
                              )
                            : await queryDecision(
                                services,
                                message.result,
                                message.date,
                                controller.signal,
                              );
      if (!controller.signal.aborted) scope.postMessage({ id: message.id, value });
    } catch (error) {
      scope.postMessage({
        id: message.id,
        error: error instanceof Error ? error.message : String(error),
        cancelled: controller.signal.aborted,
      });
    } finally {
      controllers.delete(message.id);
    }
  });
};
