import type { ArtifactRef, ComputeTask, TaskHandle } from "@bcr/core";
import {
  DAY,
  defaultBinanceRequest,
  utcDate,
  validateBinanceManifest,
  validateBinanceRequest,
  type BinanceDataset,
  type BinanceManifest,
  type BinanceRequest,
} from "@bcr/market-data/binance/model";
import {
  DEFAULT_TREND_CONFIG,
  normalizeTrendConfig,
  trendWarmupDays,
  validateTrendConfig,
  type TrendConfig,
  type TrendResult,
  type TrendRun,
} from "@bcr/quant-core/trend";
import { useRuntime } from "@bcr/react";
import { Effect } from "effect";
import { useEffect, useRef, useState } from "react";
import { readJson } from "../../data/io";

interface Saved {
  request: BinanceRequest;
  config: TrendConfig;
  dataset: BinanceDataset | null;
  runs: TrendRun[];
  selected: string | null;
}
const KEY = "trend-research-v1";
interface Operation {
  abort: AbortController;
  handle?: TaskHandle;
}
export function useTrendResearch() {
  const services = useRuntime();
  const [saved, setSaved] = useState<Saved>({
    request: defaultBinanceRequest(),
    config: { ...DEFAULT_TREND_CONFIG },
    dataset: null,
    runs: [],
    selected: null,
  });
  const [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null),
    [status, setStatus] = useState(""),
    [progress, setProgress] = useState(0);
  const [result, setResult] = useState<TrendResult | null>(null);
  const operation = useRef<Operation | null>(null);
  const saveQueue = useRef(Promise.resolve());
  useEffect(() => {
    let live = true;
    void (async () => {
      const raw = await services.metadata?.get(KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as Saved;
      // Invalid draft inputs must not prevent restoration of valid history.
      try {
        validateBinanceRequest(data.request);
      } catch {
        data.request = defaultBinanceRequest();
      }
      try {
        data.config = normalizeTrendConfig(data.config);
      } catch {
        data.config = { ...DEFAULT_TREND_CONFIG };
      }
      if (!Array.isArray(data.runs)) throw new Error("本地趋势研究记录无效");
      data.runs = data.runs.map((run) => ({ ...run, config: normalizeTrendConfig(run.config) }));
      if (data.dataset) validateBinanceManifest(data.dataset.manifest);
      if (live) setSaved(data);
    })()
      .catch((e) => {
        if (live) setError(`恢复研究失败：${String(e)}`);
      })
      .finally(() => {
        if (live) setReady(true);
      });
    return () => {
      live = false;
      const token = operation.current;
      token?.abort.abort();
      if (token?.handle) void Effect.runPromise(token.handle.cancel);
    };
  }, [services]);
  useEffect(() => {
    if (!ready) return;
    const text = JSON.stringify(saved);
    saveQueue.current = saveQueue.current
      .catch(() => undefined)
      .then(async () => {
        await services.metadata?.set(KEY, text);
      });
    void saveQueue.current.catch((e) => setError(`研究保存失败：${String(e)}`));
  }, [ready, saved, services]);
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
        const refs = await Effect.runPromise(handle.await);
        token.abort.signal.throwIfAborted();
        return { refs, cached: handle.cached };
      } finally {
        unsubscribe();
      }
    };
    try {
      let dataset = saved.dataset;
      if (
        refresh ||
        !dataset ||
        dataset.manifest.symbol !== saved.request.symbol ||
        utcDate(dataset.manifest.startTime) !== saved.request.start ||
        utcDate(dataset.manifest.endTime - 1) !== saved.request.end ||
        dataset.manifest.startTime - dataset.manifest.warmupStart <
          trendWarmupDays(saved.config) * DAY
      ) {
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
      saveQueue.current = saveQueue.current
        .catch(() => undefined)
        .then(async () => {
          token.abort.signal.throwIfAborted();
          await services.metadata?.set(KEY, JSON.stringify(next));
        });
      await saveQueue.current;
      token.abort.signal.throwIfAborted();
      setSaved(next);
      setStatus(cached ? "已复用相同数据与参数的结果" : "回测完成");
    } catch (e) {
      if (token.abort.signal.aborted) setStatus("已取消；已校验的档案可在下次复用");
      else {
        setError(String(e));
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
  };
}
