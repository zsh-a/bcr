import { contentHash, type ArtifactRef, type RuntimeServices, type TaskHandle } from "@bcr/core";
import { Effect } from "effect";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { importResearch, readJson } from "./data";
import { demoResearch } from "./demo";
import { withResearchFiles } from "./file-lease";
import { rememberSnapshot, recoverResearchFiles, researchStore } from "./storage";
import { loadFromBrowser } from "./clickhouse-browser";
import type { ClickHouseConnection, ClickHouseRange } from "./clickhouse-http";
import { validateGrid, type GridAxis, type GridResult } from "./grid";
import { replayVersions, SINGLE_EXECUTOR_VERSION } from "./versions";
import type { BenchmarkBinding } from "./benchmark";
import {
  validationPlan,
  selectValidationTests,
  costStress,
  type ValidationRequest,
  type ValidationResult,
} from "./validation";
import {
  DEFAULT_CONFIG,
  MODEL,
  validateConfig,
  type JsgConfig,
  type JsgResult,
  type ResearchDataset,
  strategySpec,
  warmupSessions,
} from "./model";
import {
  copyConfig,
  canonicalConfig,
  configKey,
  initialSession,
  readRun,
  readDataset,
  readGrid,
  readStudy,
  MAX_RUNS,
  restoreSession,
  saveSession,
  sessionReducer,
  type ResearchRun,
  type ResearchEvent,
  type ResearchOperation,
} from "./session";
import { DEFAULT_EXPERIMENT_ID, validateLibrary, type ResearchExperiment } from "./experiments";
import {
  walkForwardSchedule,
  analyzeWalkForward,
  parameterStability,
  type WalkForwardResult,
} from "./walk-forward";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
interface Active {
  experimentId: string;
  id: string;
  abort: AbortController;
  handle: TaskHandle | null;
}
export function useResearch(services: RuntimeServices) {
  const [state, reduce] = useReducer(sessionReducer, undefined, initialSession);
  const current = useRef(state);
  const active = useRef<Active | null>(null);
  const selection = useRef(0);
  const [selecting, setSelecting] = useState(false);
  const writes = useRef(Promise.resolve());
  const savedDraft = useRef(copyConfig(DEFAULT_CONFIG));
  const mounted = useRef(true);
  const send = useCallback((event: ResearchEvent) => {
    if (!mounted.current) return;
    current.current = sessionReducer(current.current, event);
    reduce(event);
  }, []);
  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    void (async () => {
      try {
        await withResearchFiles("exclusive", () => recoverResearchFiles());
        const restored = await restoreSession(services);
        if (disposed) return;
        if (restored !== null) send({ type: "restored", value: restored });
        else {
          const dataset = await importResearch(services, demoResearch().files, () => undefined);
          await rememberSnapshot(researchStore(), dataset);
          if (!disposed) send({ type: "ready", dataset });
        }
      } catch (error) {
        if (!disposed) send({ type: "ready", error: message(error) });
      }
    })();
    return () => {
      disposed = true;
      mounted.current = false;
      selection.current++;
      active.current?.abort.abort();
      if (active.current?.handle)
        void Effect.runPromise(active.current.handle.cancel).catch(() => undefined);
    };
  }, [services, send]);
  useEffect(() => {
    if (!state.ready || state.dataset === null) return;
    try {
      validateConfig(state.draft);
      savedDraft.current = copyConfig(state.draft);
    } catch {
      // Invalid in-progress edits must not prevent completed runs from being saved.
    }
    const snapshot = { ...state, draft: savedDraft.current };
    const timer = setTimeout(() => {
      writes.current = writes.current
        .then(() => saveSession(services, snapshot))
        .catch((error) => {
          send({ type: "notice", error: `保存研究失败：${message(error)}` });
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [
    services,
    send,
    state.ready,
    state.dataset,
    state.draft,
    state.runs,
    state.selected,
    state.grid,
    state.study,
    state.projects,
    state.experiments,
    state.experimentId,
    state.grids,
    state.studies,
    state.view,
  ]);
  const start = (kind: ResearchOperation["kind"], label: string): Active | null => {
    if (active.current !== null || !current.current.ready) return null;
    if (
      Math.max(
        current.current.runs.length,
        current.current.grids.length,
        current.current.studies.length,
      ) >= MAX_RUNS
    ) {
      send({ type: "notice", error: "研究目录已满，请手动移除不需要的记录" });
      return null;
    }
    const token = {
      id: crypto.randomUUID(),
      experimentId: current.current.experimentId,
      abort: new AbortController(),
      handle: null,
    };
    active.current = token;
    send({ type: "started", operation: { id: token.id, kind, label, progress: null } });
    return token;
  };
  const progress = (
    token: Active,
    label: string,
    value: number | null,
    kind?: "load" | "backtest" | "grid",
  ) => {
    token.abort.signal.throwIfAborted();
    send({ type: "progress", id: token.id, label, progress: value, ...(kind ? { kind } : {}) });
  };
  const stop = (token: Active, error?: unknown) => {
    if (active.current === token) active.current = null;
    send({
      type: "stopped",
      id: token.id,
      ...(token.abort.signal.aborted || error === undefined ? {} : { error: message(error) }),
    });
  };
  const replay = async (token: Active, dataset: ResearchDataset, config: JsgConfig) => {
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
      selection.current++;
      setSelecting(false);
      send({ type: "finished", id: token.id, selected: { run, dataset, result } });
    } finally {
      unsubscribe?.();
    }
  };
  const run = async () => {
    const snapshot = current.current;
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
      if (active.current === token) active.current = null;
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
      await rememberSnapshot(researchStore(), dataset);
      token.abort.signal.throwIfAborted();
      let draft = current.current.draft;
      if (dataset.manifest.version === 1 && draft.executionModel === "jsg-raw-v2")
        draft = { ...draft, executionModel: MODEL, fees: [] };
      send({ type: "dataset", id: token.id, dataset, draft });
      send({ type: "stopped", id: token.id });
      send({ type: "notice", error: null, status: "研究数据就绪" });
    } catch (error) {
      stop(token, error);
    } finally {
      if (active.current === token) active.current = null;
    }
  };
  const connectAndRun = async (connection: ClickHouseConnection, range: ClickHouseRange) => {
    const snapshot = current.current;
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
      const editing = current.current.draft;
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
      if (active.current === token) active.current = null;
    }
  };
  const cancel = () => {
    const token = active.current;
    if (token === null) return;
    send({ type: "progress", id: token.id, label: "正在取消…", progress: null });
    token.abort.abort();
    if (token.handle !== null)
      void Effect.runPromise(token.handle.cancel).catch((error) => {
        send({ type: "notice", error: message(error) });
      });
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
    let dataset = current.current.dataset;
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
        const editing = current.current.draft;
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
      if (active.current === token) active.current = null;
    }
  };
  const viewGridResult = async (index: number) => {
    const grid = current.current.grid;
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
      if (active.current === token) active.current = null;
    }
  };
  const runValidation = async (request: ValidationRequest) => {
    const dataset = current.current.dataset;
    if (!dataset) return;
    const base = canonicalConfig(current.current.draft);
    let plan: ReturnType<typeof validationPlan>, costs: ReturnType<typeof costStress>;
    try {
      plan = validationPlan(dataset.manifest, base, request);
      costs = costStress(base);
    } catch (error) {
      send({ type: "notice", error: message(error) });
      return;
    }
    const token = start("grid", "准备稳健性验证…");
    if (!token) return;
    const began = performance.now();
    const batch = async (configs: JsgConfig[], stage: string): Promise<GridResult> => {
      validateGrid(configs);
      progress(token, stage, 0, "grid");
      const memoryMB =
        256 +
        Math.ceil(
          (configs.length *
            (dataset.manifest.instruments.length * 128 +
              JSON.stringify(dataset.manifest).length * 2)) /
            1048576,
        );
      const handle = await Effect.runPromise(
        services.scheduler.submit({
          id: `jsg-study-${token.id}-${stage.startsWith("训练") ? "train" : stage.startsWith("测试") ? "test" : "cost"}`,
          runtime: "wasm",
          operation: "quant.grid.jsg",
          inputs: [
            { ...dataset.manifestRef, port: "manifest" },
            ...dataset.partitions.map((ref, i) => ({ ...ref, port: `partition-${i}` })),
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
      const unsubscribe = handle.state.subscribe(() => {
        if (!token.abort.signal.aborted)
          progress(token, stage, handle.state.getSnapshot().progress);
      });
      try {
        const outputs = await Effect.runPromise(handle.await);
        token.abort.signal.throwIfAborted();
        const ref = outputs.find((r) => r.type === "quant/jsg-grid-result");
        if (!ref) throw new Error("验证没有产生结果");
        const result = await readJson<GridResult>(services, ref);
        if (result.results.length !== configs.length) throw new Error("验证结果不完整");
        return result;
      } finally {
        unsubscribe();
        token.handle = null;
      }
    };
    try {
      const training = plan.training.length
        ? await batch(plan.training, `训练 · ${plan.training.length} 组`)
        : { results: [], decodedRows: 0 };
      token.abort.signal.throwIfAborted();
      const choices = selectValidationTests(plan, training, request.objective);
      const tests = choices.length
        ? await batch(
            choices.map((c) => c.config),
            `测试 · ${choices.length} 个窗口`,
          )
        : { results: [], decodedRows: 0 };
      const costResult = await batch(costs.configs, "成本压力 · 0.5 / 1 / 2 / 3 倍");
      token.abort.signal.throwIfAborted();
      let continuous: WalkForwardResult | undefined;
      if (request.mode === "walk-forward") {
        const { config, schedule } = walkForwardSchedule(
          dataset.manifest,
          choices.map((c) => c.config),
          plan.folds,
        );
        progress(token, "连续样本外 · 延续账户回放", 0, "grid");
        const handle = await Effect.runPromise(
          services.scheduler.submit({
            id: `jsg-study-${token.id}-continuous`,
            runtime: "wasm",
            operation: "quant.backtest.jsg",
            inputs: [
              { ...dataset.manifestRef, port: "manifest" },
              ...dataset.partitions.map((r, i) => ({ ...r, port: `partition-${i}` })),
            ],
            outputs: [
              { name: "result", type: "quant/jsg-result", storage: "opfs", format: "json" },
            ],
            resources: { memoryMB: 256, threads: 1 },
            cache: { enabled: true },
            config: { strategy: config, schedule },
          }),
        );
        token.handle = handle;
        if (token.abort.signal.aborted) {
          await Effect.runPromise(handle.cancel);
          token.abort.signal.throwIfAborted();
        }
        const unsubscribe = handle.state.subscribe(() => {
          if (!token.abort.signal.aborted)
            progress(token, "连续样本外 · 延续账户回放", handle.state.getSnapshot().progress);
        });
        try {
          const outputs = await Effect.runPromise(handle.await);
          token.abort.signal.throwIfAborted();
          const resultRef = outputs.find((r) => r.type === "quant/jsg-result");
          if (!resultRef) throw new Error("连续回放没有产生结果");
          const replay = await readJson<JsgResult>(services, resultRef);
          progress(token, "分析连续样本外表现…", null, "grid");
          const analysis = await analyzeWalkForward(
            services,
            dataset.manifest,
            replay,
            config,
            plan.folds,
            token.abort.signal,
          );
          continuous = {
            config,
            schedule,
            resultRef,
            result: replay,
            ...analysis,
            stability: parameterStability(schedule, request.axes),
          };
        } finally {
          unsubscribe();
          token.handle = null;
        }
      }
      token.abort.signal.throwIfAborted();
      const result: ValidationResult = {
        version: 2,
        request: structuredClone(request),
        training: training.results,
        costBase: base,
        folds: plan.folds.map((f, i) => ({
          ...f,
          config: choices[i]!.config,
          trainMetrics: choices[i]!.trainMetrics,
          testMetrics: tests.results[i]!.metrics,
        })),
        costs: costs.rows.map((r) => ({
          multiplier: r.multiplier,
          metrics: costResult.results.find((c) => configKey(c.config) === configKey(r.config))!
            .metrics,
        })),
        ...(continuous ? { continuous } : {}),
      };
      const bytes = new TextEncoder().encode(JSON.stringify(result));
      const resultRef: ArtifactRef = {
        id: `jsg/study/${token.id}`,
        hash: contentHash(bytes),
        type: "quant/jsg-study-result",
        format: "json",
        storage: "opfs",
      };
      await Effect.runPromise(services.artifacts.put(resultRef, bytes));
      token.abort.signal.throwIfAborted();
      send({
        type: "study-finished",
        id: token.id,
        study: {
          dataset,
          result,
          run: {
            experimentId: token.experimentId,
            versions: {
              ...replayVersions(true, base),
              validation: "quant-validation-2",
              ...(continuous ? { continuousExecutor: SINGLE_EXECUTOR_VERSION } : {}),
            },
            validationMode: request.mode,
            id: token.id,
            createdAt: new Date().toISOString(),
            dataset: {
              manifestRef: dataset.manifestRef,
              partitions: dataset.partitions,
              ...(dataset.snapshot ? { snapshot: dataset.snapshot } : {}),
            },
            ...(dataset.snapshot ? { snapshot: structuredClone(dataset.snapshot) } : {}),
            name: dataset.manifest.name,
            startDate: dataset.manifest.startDate,
            endDate: dataset.manifest.endDate,
            resultRef,
            durationMs: performance.now() - began,
            cached: false,
          },
        },
      });
    } catch (error) {
      stop(token, error);
    } finally {
      if (active.current === token) active.current = null;
    }
  };
  const selectRun = async (id: string) => {
    const run = current.current.runs.find((item) => item.id === id);
    if (!run) return;
    const request = ++selection.current;
    setSelecting(true);
    try {
      const selected = await withResearchFiles("shared", () => readRun(services, run));
      if (selection.current === request && current.current.runs.some((r) => r.id === id))
        send({ type: "selected", selected });
    } catch (error) {
      if (selection.current === request) send({ type: "notice", error: message(error) });
    } finally {
      if (selection.current === request && mounted.current) setSelecting(false);
    }
  };
  const selectEntry = async (kind: "run" | "grid" | "study", id: string) => {
    if (active.current) return;
    if (kind === "run") return selectRun(id);
    const run =
      kind === "grid"
        ? current.current.grids.find((r) => r.id === id)
        : current.current.studies.find((r) => r.id === id);
    if (!run) return;
    const request = ++selection.current;
    setSelecting(true);
    try {
      await withResearchFiles("shared", async () => {
        if (kind === "grid") {
          const grid = await readGrid(services, run as import("./session").ResearchGrid);
          if (request === selection.current && current.current.grids.some((r) => r.id === id))
            send({ type: "grid-selected", grid });
        } else {
          const study = await readStudy(services, run);
          if (request === selection.current && current.current.studies.some((r) => r.id === id))
            send({ type: "study-selected", study });
        }
      });
    } catch (error) {
      if (request === selection.current) send({ type: "notice", error: message(error) });
    } finally {
      if (request === selection.current && mounted.current) setSelecting(false);
    }
  };
  const selectExperiment = async (id: string) => {
    if (active.current || !current.current.experiments.some((e) => e.id === id)) return;
    selection.current++;
    setSelecting(false);
    send({ type: "experiment-selected", id });
    const entries = [
      ...current.current.runs.map((r) => ({ ...r, kind: "run" as const })),
      ...current.current.grids.map((r) => ({ ...r, kind: "grid" as const })),
      ...current.current.studies.map((r) => ({ ...r, kind: "study" as const })),
    ]
      .filter((r) => (r.experimentId ?? DEFAULT_EXPERIMENT_ID) === id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (entries[0]) await selectEntry(entries[0].kind, entries[0].id);
  };
  const createExperiment = (name: string, projectId?: string) => {
    if (active.current) return;
    const experiment: ResearchExperiment = {
      id: crypto.randomUUID(),
      projectId:
        projectId ??
        current.current.experiments.find((e) => e.id === current.current.experimentId)!.projectId,
      name: name.trim(),
      notes: "",
      tags: [],
      favorite: false,
      baselineId: null,
      createdAt: new Date().toISOString(),
    };
    try {
      validateLibrary(
        current.current.projects,
        [...current.current.experiments, experiment],
        experiment.id,
      );
      selection.current++;
      setSelecting(false);
      send({ type: "experiment-created", experiment });
    } catch (error) {
      send({ type: "notice", error: message(error) });
    }
  };
  return {
    state,
    setView: (view: import("./session").ResearchSession["view"]) => send({ type: "view", view }),
    selecting,
    run: () => withResearchFiles("shared", run),
    runGrid: (
      configs: JsgConfig[],
      axes: GridAxis[],
      source?: { connection: ClickHouseConnection; range: ClickHouseRange },
    ) => withResearchFiles("shared", () => runGrid(configs, axes, source)),
    viewGridResult: (index: number) => withResearchFiles("shared", () => viewGridResult(index)),
    forgetGrid: () => {
      if (current.current.grid)
        send({ type: "entry-forgotten", kind: "grid", id: current.current.grid.run.id });
    },
    runValidation: (request: ValidationRequest) =>
      withResearchFiles("shared", () => runValidation(request)),
    forgetStudy: () => {
      if (current.current.study)
        send({ type: "entry-forgotten", kind: "study", id: current.current.study.run.id });
    },
    createExperiment,
    createProject: (name: string) => {
      if (active.current) return;
      const project = {
        id: crypto.randomUUID(),
        name: name.trim(),
        createdAt: new Date().toISOString(),
      };
      const experiment = {
        id: crypto.randomUUID(),
        projectId: project.id,
        name: "策略探索",
        notes: "",
        tags: [],
        favorite: false,
        baselineId: null,
        createdAt: project.createdAt,
      };
      try {
        validateLibrary(
          [...current.current.projects, project],
          [...current.current.experiments, experiment],
          experiment.id,
        );
        selection.current++;
        setSelecting(false);
        send({ type: "project-created", project, experiment });
      } catch (error) {
        send({ type: "notice", error: message(error) });
      }
    },
    updateExperiment: (
      id: string,
      patch: Partial<
        Pick<ResearchExperiment, "name" | "notes" | "tags" | "favorite" | "baselineId">
      >,
    ) => {
      try {
        send({ type: "experiment-updated", id, patch });
      } catch (error) {
        send({ type: "notice", error: message(error) });
      }
    },
    renameProject: (id: string, name: string) => {
      try {
        send({ type: "project-renamed", id, name: name.trim() });
      } catch (error) {
        send({ type: "notice", error: message(error) });
      }
    },
    selectExperiment,
    selectEntry,
    forgetEntry: (kind: "run" | "grid" | "study", id: string) =>
      send(kind === "run" ? { type: "forgotten", id } : { type: "entry-forgotten", kind, id }),
    attachBenchmark: (runId: string, benchmark?: BenchmarkBinding) =>
      send({ type: "benchmark", runId, ...(benchmark ? { benchmark } : {}) }),
    connectAndRun: (connection: ClickHouseConnection, range: ClickHouseRange) =>
      withResearchFiles("shared", () => connectAndRun(connection, range)),
    importFiles: (files: readonly File[]) => withResearchFiles("shared", () => importFiles(files)),
    getSession: () => current.current,
    flush: async () => {
      await writes.current;
      await saveSession(services, { ...current.current, draft: savedDraft.current });
    },
    useDataset: (dataset: ResearchDataset) =>
      withResearchFiles("shared", async () => {
        if (active.current) throw new Error("请等待当前任务结束");
        const available = await readDataset(services, dataset);
        send({ type: "choose-dataset", dataset: available });
      }),
    forgetRun: (id: string) => send({ type: "forgotten", id }),
    cancel,
    selectRun,
    change: (patch: Partial<JsgConfig>) => send({ type: "draft", patch }),
    reset: (config: JsgConfig) => send({ type: "replace-draft", config }),
    useRunConfig: () => {
      if (current.current.selected)
        send({ type: "replace-draft", config: current.current.selected.run.config });
    },
    notice: (error: string | null, status?: string) =>
      send({ type: "notice", error, ...(status !== undefined ? { status } : {}) }),
  };
}
