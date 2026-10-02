import { loadFromBrowser } from "@bcr/market-data/research/clickhouse-browser";
import type {
  ClickHouseConnection,
  ClickHouseRange,
} from "@bcr/market-data/research/clickhouse-http";
import { type ResearchDataset } from "@bcr/market-data/research/model";
import {
  MODEL,
  strategySpec,
  validateConfig,
  warmupSessions,
  type JsgConfig,
  type JsgResult,
} from "@bcr/quant-core";
import { Effect } from "effect";
import { importResearch, readJson } from "../data/io";
import { rememberSnapshot } from "../data/storage";
import { replayVersions } from "../execution/versions";
import { validateGrid, type GridAxis, type GridResult } from "../experiments/grid";
import { DEFAULT_EXPERIMENT_ID } from "../experiments/model";
import { canonicalConfig } from "../session/config";
import { type ResearchRun } from "../session/model";
import { readDataset } from "../session/persistence";
import type { OperationContext, OperationToken } from "./operation-context";
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function createBacktestOperations(context: OperationContext) {
  const { services, binary, getState, start, progress, send, stop, release, resetSelection } =
    context;
  const replay = async (token: OperationToken, dataset: ResearchDataset, config: JsgConfig) => {
    validateConfig(config);
    const strategy = canonicalConfig(config);
    const began = performance.now();
    progress(token, "等待回测…", 0, "backtest");
    let unsubscribe: (() => void) | undefined;
    try {
      const handle = await Effect.runPromise(
        services.scheduler.submit({
          id: `jsg-${token.id}`,
          runtime: "wasm",
          operation: "quant.backtest.jsg",
          inputs: [
            { ...dataset.manifestRef, port: "manifest" },
            ...dataset.partitions.map((ref, i) => ({ ...ref, port: `partition-${i}` })),
          ],
          outputs: [{ name: "result", type: "quant/jsg-result", storage: "opfs", format: "json" }],
          resources: { memoryMB: 256, threads: 1 },
          cache: { enabled: true },
          config: { model: strategy.executionModel ?? MODEL, strategy },
        }),
      );
      token.handle = handle;
      if (token.abort.signal.aborted) {
        await Effect.runPromise(handle.cancel);
        token.abort.signal.throwIfAborted();
      }
      const update = () => {
        if (!token.abort.signal.aborted)
          progress(token, "正在逐日回放…", handle.state.getSnapshot().progress);
      };
      unsubscribe = handle.state.subscribe(update);
      update();
      const outputs = await Effect.runPromise(handle.await);
      token.abort.signal.throwIfAborted();
      const ref = outputs.find((output) => output.type === "quant/jsg-result");
      if (ref === undefined) throw new Error("回测没有产生结果");
      const result = await readJson<JsgResult>(services, ref);
      token.abort.signal.throwIfAborted();
      const run: ResearchRun = {
        experimentId: token.experimentId,
        versions: replayVersions(false, strategy),
        ...(dataset.snapshot ? { snapshot: structuredClone(dataset.snapshot) } : {}),
        id: token.id,
        createdAt: new Date().toISOString(),
        config: strategy,
        dataset: {
          manifestRef: dataset.manifestRef,
          partitions: dataset.partitions,
          ...(dataset.snapshot ? { snapshot: dataset.snapshot } : {}),
        },
        name: dataset.manifest.name,
        startDate: config.researchWindow?.start ?? dataset.manifest.startDate,
        endDate: config.researchWindow?.end ?? dataset.manifest.endDate,
        resultRef: ref,
        metrics: result.metrics,
        durationMs: performance.now() - began,
        cached: handle.cached,
      };
      resetSelection();
      send({ type: "finished", id: token.id, selected: { run, dataset, result } });
    } finally {
      unsubscribe?.();
    }
  };
  const run = async () => {
    const snapshot = getState();
    if (snapshot.dataset === null) return;
    try {
      validateConfig(snapshot.draft);
    } catch (error) {
      send({ type: "notice", error: message(error) });
      return;
    }
    const token = start("backtest", "准备回测…");
    if (token === null) return;
    try {
      await replay(token, snapshot.dataset, snapshot.draft);
    } catch (error) {
      stop(token, error);
    } finally {
      release(token);
    }
  };
  const importFiles = async (files: readonly File[]) => {
    const token = start("import", "导入研究数据…");
    if (token === null) return;
    try {
      const dataset = await importResearch(
        services,
        files,
        (text) => progress(token, text, null),
        token.abort.signal,
      );
      await rememberSnapshot(binary, dataset);
      token.abort.signal.throwIfAborted();
      let draft = getState().draft;
      if (dataset.manifest.version === 1 && draft.executionModel === "jsg-raw-v2")
        draft = { ...draft, executionModel: MODEL, fees: [] };
      send({ type: "dataset", id: token.id, dataset, draft });
      send({ type: "stopped", id: token.id });
      send({ type: "notice", error: null, status: "研究数据就绪" });
    } catch (error) {
      stop(token, error);
    } finally {
      release(token);
    }
  };
  const connectAndRun = async (connection: ClickHouseConnection, range: ClickHouseRange) => {
    const snapshot = getState();
    try {
      validateConfig(snapshot.draft);
    } catch (error) {
      send({ type: "notice", error: message(error) });
      return;
    }
    const token = start("load", "准备研究数据…");
    if (token === null) return;
    try {
      const loaded = await loadFromBrowser(
        connection,
        { ...range, warmupSessions: Math.max(30, warmupSessions(strategySpec(snapshot.draft))) },
        token.abort.signal,
        (value) => {
          progress(token, value.text, value.total ? value.completed / value.total : null);
        },
      );
      token.abort.signal.throwIfAborted();
      const draft: JsgConfig =
        loaded.dataset.manifest.version === 1 && snapshot.draft.executionModel === "jsg-raw-v2"
          ? { ...snapshot.draft, executionModel: MODEL, fees: [] }
          : snapshot.draft;
      const editing = getState().draft;
      send({
        type: "dataset",
        id: token.id,
        dataset: loaded.dataset,
        draft:
          loaded.dataset.manifest.version === 1 && editing.executionModel === "jsg-raw-v2"
            ? { ...editing, executionModel: MODEL, fees: [] }
            : editing,
      });
      await replay(token, loaded.dataset, draft);
    } catch (error) {
      stop(token, error);
    } finally {
      release(token);
    }
  };
  const runGrid = async (
    strategies: JsgConfig[],
    axes: GridAxis[],
    source?: { connection: ClickHouseConnection; range: ClickHouseRange },
  ) => {
    let configs = strategies.map(canonicalConfig);
    const capturedAxes = structuredClone(axes);
    try {
      validateGrid(configs);
    } catch (error) {
      send({ type: "notice", error: message(error) });
      return;
    }
    let dataset = getState().dataset;
    if (!source && !dataset) return;
    const token = start(source ? "load" : "grid", "准备参数实验…");
    if (!token) return;
    const began = performance.now();
    let unsubscribe: (() => void) | undefined;
    try {
      if (source) {
        const loaded = await loadFromBrowser(
          source.connection,
          {
            ...source.range,
            warmupSessions: Math.max(30, ...configs.map((c) => warmupSessions(strategySpec(c)))),
          },
          token.abort.signal,
          (value) => {
            progress(token, value.text, value.total ? value.completed / value.total : null);
          },
        );
        dataset = loaded.dataset;
        if (dataset.manifest.version === 1)
          configs = configs.map((config) =>
            config.executionModel === "jsg-raw-v2"
              ? { ...config, executionModel: MODEL, fees: [] }
              : config,
          );
        const editing = getState().draft;
        send({
          type: "dataset",
          id: token.id,
          dataset,
          draft:
            dataset.manifest.version === 1 && editing.executionModel === "jsg-raw-v2"
              ? { ...editing, executionModel: MODEL, fees: [] }
              : editing,
        });
      }
      token.abort.signal.throwIfAborted();
      const input = dataset!;
      progress(token, `参数实验 · ${configs.length} 组 · 准备回放…`, 0, "grid");
      const memoryMB =
        256 +
        Math.ceil(
          (configs.length *
            (input.manifest.instruments.length * 128 + JSON.stringify(input.manifest).length * 2)) /
            1048576,
        );
      const handle = await Effect.runPromise(
        services.scheduler.submit({
          id: `jsg-grid-${token.id}`,
          runtime: "wasm",
          operation: "quant.grid.jsg",
          inputs: [
            { ...input.manifestRef, port: "manifest" },
            ...input.partitions.map((ref, i) => ({ ...ref, port: `partition-${i}` })),
          ],
          outputs: [
            { name: "result", type: "quant/jsg-grid-result", storage: "opfs", format: "json" },
          ],
          resources: { memoryMB, threads: 1 },
          cache: { enabled: true },
          config: { strategies: configs },
        }),
      );
      token.handle = handle;
      if (token.abort.signal.aborted) {
        await Effect.runPromise(handle.cancel);
        token.abort.signal.throwIfAborted();
      }
      const update = () => {
        if (!token.abort.signal.aborted)
          progress(
            token,
            `参数实验 · ${configs.length} 组 · 正在回放…`,
            handle.state.getSnapshot().progress,
          );
      };
      unsubscribe = handle.state.subscribe(update);
      update();
      const outputs = await Effect.runPromise(handle.await);
      token.abort.signal.throwIfAborted();
      const resultRef = outputs.find((ref) => ref.type === "quant/jsg-grid-result");
      if (!resultRef) throw new Error("参数实验没有产生结果");
      const result = await readJson<GridResult>(services, resultRef);
      token.abort.signal.throwIfAborted();
      send({
        type: "grid-finished",
        id: token.id,
        grid: {
          run: {
            experimentId: token.experimentId,
            versions: replayVersions(true, configs[0]),
            id: token.id,
            createdAt: new Date().toISOString(),
            axes: capturedAxes,
            dataset: {
              manifestRef: input.manifestRef,
              partitions: input.partitions,
              ...(input.snapshot ? { snapshot: input.snapshot } : {}),
            },
            ...(input.snapshot ? { snapshot: structuredClone(input.snapshot) } : {}),
            name: input.manifest.name,
            startDate: input.manifest.startDate,
            endDate: input.manifest.endDate,
            resultRef,
            durationMs: performance.now() - began,
            cached: handle.cached,
          },
          dataset: input,
          result,
        },
      });
    } catch (error) {
      stop(token, error);
    } finally {
      unsubscribe?.();
      release(token);
    }
  };
  const viewGridResult = async (index: number) => {
    const grid = getState().grid;
    const row = grid?.result.results[index];
    if (!grid || !row) return;
    const token = start("backtest", "生成完整结果…");
    if (!token) return;
    token.experimentId = grid.run.experimentId ?? DEFAULT_EXPERIMENT_ID;
    try {
      const dataset = await readDataset(services, grid.dataset);
      token.abort.signal.throwIfAborted();
      await replay(token, dataset, row.config);
    } catch (error) {
      stop(token, error);
    } finally {
      release(token);
    }
  };
  return { run, importFiles, connectAndRun, runGrid, viewGridResult };
}
