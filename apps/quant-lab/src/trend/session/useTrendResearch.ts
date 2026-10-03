import type { ArtifactRef, ComputeTask, TaskHandle } from "@bcr/core";
import {
  validateBinanceManifest,
  validateBinanceRequest,
  type BinanceManifest,
  type BinanceRequest,
} from "@bcr/market-data/binance/model";
import {
  trendWarmupDays,
  validateTrendConfig,
  type TrendConfig,
  type TrendResult,
  type TrendRun,
} from "@bcr/quant-core/trend";
import { useRuntime } from "@bcr/react";
import { Effect, Either } from "effect";
import { useEffect, useMemo, useRef, useState } from "react";
import { readJson } from "../../data/io";
import { canReuseTrendDataset } from "../execution/window";
import { createTrendSessionState, createTrendSessionStore, type TrendSessionStore } from "./store";
interface Operation {
  abort: AbortController;
  handle?: TaskHandle;
}
export function useTrendResearch() {
  const services = useRuntime();
  const store = useMemo(() => createTrendSessionStore(services.metadata), [services.metadata]);
  const [saved, setSaved] = useState(createTrendSessionState);
  const [restoredStore, setRestoredStore] = useState<TrendSessionStore | null>(null);
  const ready = restoredStore === store;
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null),
    [status, setStatus] = useState(""),
    [progress, setProgress] = useState(0);
  const [result, setResult] = useState<TrendResult | null>(null);
  const operation = useRef<Operation | null>(null);
  useEffect(() => {
    let live = true;
    void store
      .restore()
      .then(({ state, notice }) => {
        if (!live) return;
        setSaved(state);
        setError(null);
        setNotice(notice || null);
        setStatus("");
        setRestoredStore(store);
      })
      .catch((e) => {
        if (!live) return;
        setNotice(null);
        setError(
          `恢复研究失败：${e instanceof Error ? e.message : String(e)}。原始记录已保留，回测已停用；请重新加载后重试。`,
        );
        setStatus("恢复研究失败 · 已阻止覆盖本地记录");
      });
    return () => {
      live = false;
      const token = operation.current;
      token?.abort.abort();
      if (token?.handle) void Effect.runPromise(token.handle.cancel);
    };
  }, [store]);
  useEffect(() => {
    if (!ready) return;
    void store.save(saved).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [ready, saved, store]);
  const selected = saved.runs.find((run) => run.id === saved.selected) ?? null;
  useEffect(() => {
    let live = true;
    setResult(null);
    if (selected)
      void readJson<TrendResult>(services, selected.resultRef)
        .then((value) => {
          if (live) setResult(value);
        })
        .catch((e) => {
          if (live) setError(`读取结果失败：${String(e)}`);
        });
    return () => {
      live = false;
    };
  }, [services, selected]);
  const run = async (refresh = false) => {
    if (!ready || operation.current) return;
    try {
      validateBinanceRequest(saved.request);
      validateTrendConfig(saved.config);
    } catch (e) {
      setError(String(e));
      return;
    }
    const token: Operation = { abort: new AbortController() };
    operation.current = token;
    setBusy(true);
    setError(null);
    setProgress(0);
    const began = performance.now();
    const submit = async (
      task: ComputeTask,
      label: string,
    ): Promise<{ refs: readonly ArtifactRef[]; cached: boolean }> => {
      token.abort.signal.throwIfAborted();
      setStatus(label);
      setProgress(0);
      const handle = await Effect.runPromise(services.scheduler.submit(task));
      token.handle = handle;
      if (token.abort.signal.aborted) {
        await Effect.runPromise(handle.cancel);
        token.abort.signal.throwIfAborted();
      }
      const update = () => {
        if (!token.abort.signal.aborted) setProgress(handle.state.getSnapshot().progress);
      };
      const unsubscribe = handle.state.subscribe(update);
      update();
      try {
        const outcome = await Effect.runPromise(Effect.either(handle.await));
        if (Either.isLeft(outcome)) throw new Error(outcome.left.message);
        const refs = outcome.right;
        token.abort.signal.throwIfAborted();
        return { refs, cached: handle.cached };
      } finally {
        unsubscribe();
      }
    };
    try {
      let dataset = saved.dataset;
      if (refresh || !canReuseTrendDataset(dataset ?? undefined, saved.request, saved.config)) {
        const { refs } = await submit(
          {
            id: `binance-${crypto.randomUUID()}`,
            runtime: "wasm",
            operation: "market.binance.history",
            inputs: [],
            outputs: [
              {
                name: "manifest",
                type: "market/binance-manifest",
                storage: "opfs",
                format: "json",
              },
            ],
            resources: { memoryMB: 256, threads: 1 },
            cache: { enabled: false },
            config: {
              request: { ...saved.request, warmupDays: trendWarmupDays(saved.config) },
              refresh,
            },
          },
          "获取并校验 Binance 历史档案",
        );
        const manifestRef = refs.find((ref) => ref.type === "market/binance-manifest");
        if (!manifestRef) throw new Error("未生成完整行情清单");
        const manifest = await readJson<BinanceManifest>(services, manifestRef);
        validateBinanceManifest(manifest);
        dataset = { manifest, manifestRef };
        token.abort.signal.throwIfAborted();
        setSaved((value) => ({ ...value, dataset }));
      }
      if (!dataset) throw new Error("趋势回测缺少行情数据");
      const { refs, cached } = await submit(
        {
          id: `trend-${crypto.randomUUID()}`,
          runtime: "wasm",
          operation: "quant.backtest.trend",
          inputs: [
            ...new Map(
              [
                { ...dataset.manifestRef, port: "manifest" },
                dataset.manifest.funding,
                ...dataset.manifest.partitions.flatMap((p) => [p.candles, p.marks]),
              ].map((ref) => [ref.id, ref]),
            ).values(),
          ],
          outputs: [
            { name: "result", type: "quant/trend-result", storage: "opfs", format: "json" },
          ],
          resources: { memoryMB: 256, threads: 1 },
          cache: { enabled: true },
          config: { strategy: saved.config },
        },
        "Rust 逐分钟回放",
      );
      const resultRef = refs.find((ref) => ref.type === "quant/trend-result");
      if (!resultRef) throw new Error("回测未产生结果");
      const value = await readJson<TrendResult>(services, resultRef);
      token.abort.signal.throwIfAborted();
      const history: TrendRun = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        config: structuredClone(saved.config),
        dataset,
        resultRef,
        metrics: value.metrics,
        durationMs: performance.now() - began,
        cached,
      };
      const next = { ...saved, dataset, runs: [history, ...saved.runs], selected: history.id };
      // Publish only after the selected run is durable, including on immediate reload.
      await store.save(next, token.abort.signal);
      token.abort.signal.throwIfAborted();
      setSaved(next);
      setStatus(cached ? "已复用相同数据与参数的结果" : "回测完成");
    } catch (e) {
      if (token.abort.signal.aborted) setStatus("已取消；已校验的档案可在下次复用");
      else {
        setError(e instanceof Error ? e.message : String(e));
        setStatus("回测失败");
      }
    } finally {
      if (operation.current === token) {
        operation.current = null;
        setBusy(false);
      }
    }
  };
  const cancel = () => {
    const token = operation.current;
    token?.abort.abort();
    if (token?.handle) void Effect.runPromise(token.handle.cancel);
  };
  return {
    ...saved,
    ready,
    busy,
    error,
    notice,
    status,
    progress,
    result,
    selected,
    run,
    cancel,
    setRequest: (request: BinanceRequest) => setSaved((s) => ({ ...s, request })),
    setConfig: (config: TrendConfig) => setSaved((s) => ({ ...s, config })),
    select: (id: string) => setSaved((s) => ({ ...s, selected: id })),
    dismissError: () => setError(null),
    dismissNotice: () => setNotice(null),
  };
}
