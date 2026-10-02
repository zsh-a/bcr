import { contentHash, type ArtifactRef, type RuntimeServices, type TaskHandle } from "@bcr/core";
import { Effect } from "effect";
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
  type ResearchSession,
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
export interface ResearchSnapshot {
  state: ResearchSession;
  selecting: boolean;
}
/** Domain orchestration owns persistence and operations independently of any React view. */
export function createResearchService(services: RuntimeServices) {
  const binary = services.binary ?? researchStore();
  let state = initialSession();
  let active: Active | null = null;
  let selection = 0;
  let writes = Promise.resolve();
  let savedDraft = copyConfig(DEFAULT_CONFIG);
  let open = true;
  let selecting = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let initializing: Promise<void> | undefined;
  let closing: Promise<void> | undefined;
  const accepted = new Set<Promise<unknown>>();
  const listeners = new Set<() => void>();
  let snapshot: ResearchSnapshot = { state: state, selecting };
  const publish = () => {
    snapshot = { state: state, selecting };
    for (const listener of listeners) listener();
  };
  const setSelecting = (value: boolean) => {
    if (!open) return;
    selecting = value;
    publish();
  };
  const persistDraft = () => {
    try {
      validateConfig(state.draft);
      savedDraft = copyConfig(state.draft);
    } catch {
      /* Preserve the last valid draft. */
    }
  };
  const flush = async () => {
    clearTimeout(timer);
    await writes;
    persistDraft();
    await saveSession(services, { ...state, draft: savedDraft });
  };
  const send = (event: ResearchEvent) => {
    if (!open) return;
    state = sessionReducer(state, event);
    publish();
    if (
      !state.ready ||
      !state.dataset ||
      ["progress", "started", "stopped", "notice"].includes(event.type)
    )
      return;
    persistDraft();
    clearTimeout(timer);
    timer = setTimeout(() => {
      const value = { ...state, draft: savedDraft };
      writes = writes
        .then(() => saveSession(services, value))
        .catch((error) => send({ type: "notice", error: `保存研究失败：${message(error)}` }));
    }, 300);
  };
  const initialize = () => {
    if (!open) return Promise.reject(new Error("研究会话已关闭"));
    return (initializing ??= (async () => {
      try {
        await withResearchFiles("exclusive", () => recoverResearchFiles(binary));
        const restored = await restoreSession(services);
        if (!open) return;
        if (restored !== null) send({ type: "restored", value: restored });
        else {
          const dataset = await importResearch(services, demoResearch().files, () => undefined);
          await rememberSnapshot(binary, dataset);
          if (open) send({ type: "ready", dataset });
        }
      } catch (error) {
        if (open) send({ type: "ready", error: message(error) });
      }
    })());
  };
  const track = <T>(work: () => Promise<T>): Promise<T> => {
    if (!open) return Promise.reject(new Error("研究会话已关闭"));
    const operation = work();
    accepted.add(operation);
    void operation.finally(() => accepted.delete(operation)).catch(() => undefined);
    return operation;
  };
  const start = (kind: ResearchOperation["kind"], label: string): Active | null => {
    if (!open || active !== null || !state.ready) return null;
    if (Math.max(state.runs.length, state.grids.length, state.studies.length) >= MAX_RUNS) {
      send({ type: "notice", error: "研究目录已满，请手动移除不需要的记录" });
      return null;
    }
    const token = {
      id: crypto.randomUUID(),
      experimentId: state.experimentId,
      abort: new AbortController(),
      handle: null,
    };
    active = token;
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
    if (active === token) active = null;
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
      selection++;
      setSelecting(false);
      send({ type: "finished", id: token.id, selected: { run, dataset, result } });
    } finally {
      unsubscribe?.();
    }
  };
  const run = async () => {
    const snapshot = state;
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
      if (active === token) active = null;
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
      let draft = state.draft;
      if (dataset.manifest.version === 1 && draft.executionModel === "jsg-raw-v2")
        draft = { ...draft, executionModel: MODEL, fees: [] };
      send({ type: "dataset", id: token.id, dataset, draft });
      send({ type: "stopped", id: token.id });
      send({ type: "notice", error: null, status: "研究数据就绪" });
    } catch (error) {
      stop(token, error);
    } finally {
      if (active === token) active = null;
    }
  };
  const connectAndRun = async (connection: ClickHouseConnection, range: ClickHouseRange) => {
    const snapshot = state;
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
      const editing = state.draft;
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
      if (active === token) active = null;
    }
  };
  const cancel = () => {
    const token = active;
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
    let dataset = state.dataset;
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
        const editing = state.draft;
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
      if (active === token) active = null;
    }
  };
  const viewGridResult = async (index: number) => {
    const grid = state.grid;
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
      if (active === token) active = null;
    }
  };
  const runValidation = async (request: ValidationRequest) => {
    const dataset = state.dataset;
    if (!dataset) return;
    const base = canonicalConfig(state.draft);
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
    const batch = async (
      configs: JsgConfig[],
      stage: { id: "train" | "test" | "cost"; label: string },
    ): Promise<GridResult> => {
      validateGrid(configs);
      progress(token, stage.label, 0, "grid");
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
          id: `jsg-study-${token.id}-${stage.id}`,
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
          progress(token, stage.label, handle.state.getSnapshot().progress);
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
        ? await batch(plan.training, { id: "train", label: `训练 · ${plan.training.length} 组` })
        : { results: [], decodedRows: 0 };
      token.abort.signal.throwIfAborted();
      const choices = selectValidationTests(plan, training, request.objective);
      const tests = choices.length
        ? await batch(
            choices.map((c) => c.config),
            { id: "test", label: `测试 · ${choices.length} 个窗口` },
          )
        : { results: [], decodedRows: 0 };
      const costResult = await batch(costs.configs, {
        id: "cost",
        label: "成本压力 · 0.5 / 1 / 2 / 3 倍",
      });
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
      if (active === token) active = null;
    }
  };
  const selectRun = async (id: string) => {
    const run = state.runs.find((item) => item.id === id);
    if (!run) return;
    const request = ++selection;
    setSelecting(true);
    try {
      const selected = await withResearchFiles("shared", () => readRun(services, run));
      if (selection === request && state.runs.some((r) => r.id === id))
        send({ type: "selected", selected });
    } catch (error) {
      if (selection === request) send({ type: "notice", error: message(error) });
    } finally {
      if (selection === request && open) setSelecting(false);
    }
  };
  const selectEntry = async (kind: "run" | "grid" | "study", id: string) => {
    if (active) return;
    if (kind === "run") return selectRun(id);
    const run =
      kind === "grid"
        ? state.grids.find((r) => r.id === id)
        : state.studies.find((r) => r.id === id);
    if (!run) return;
    const request = ++selection;
    setSelecting(true);
    try {
      await withResearchFiles("shared", async () => {
        if (kind === "grid") {
          const grid = await readGrid(services, run as import("./session").ResearchGrid);
          if (request === selection && state.grids.some((r) => r.id === id))
            send({ type: "grid-selected", grid });
        } else {
          const study = await readStudy(services, run);
          if (request === selection && state.studies.some((r) => r.id === id))
            send({ type: "study-selected", study });
        }
      });
    } catch (error) {
      if (request === selection) send({ type: "notice", error: message(error) });
    } finally {
      if (request === selection && open) setSelecting(false);
    }
  };
  const selectExperiment = async (id: string) => {
    if (active || !state.experiments.some((e) => e.id === id)) return;
    selection++;
    setSelecting(false);
    send({ type: "experiment-selected", id });
    const entries = [
      ...state.runs.map((r) => ({ ...r, kind: "run" as const })),
      ...state.grids.map((r) => ({ ...r, kind: "grid" as const })),
      ...state.studies.map((r) => ({ ...r, kind: "study" as const })),
    ]
      .filter((r) => (r.experimentId ?? DEFAULT_EXPERIMENT_ID) === id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (entries[0]) await selectEntry(entries[0].kind, entries[0].id);
  };
  const createExperiment = (name: string, projectId?: string) => {
    if (active) return;
    const experiment: ResearchExperiment = {
      id: crypto.randomUUID(),
      projectId: projectId ?? state.experiments.find((e) => e.id === state.experimentId)!.projectId,
      name: name.trim(),
      notes: "",
      tags: [],
      favorite: false,
      baselineId: null,
      createdAt: new Date().toISOString(),
    };
    try {
      validateLibrary(state.projects, [...state.experiments, experiment], experiment.id);
      selection++;
      setSelecting(false);
      send({ type: "experiment-created", experiment });
    } catch (error) {
      send({ type: "notice", error: message(error) });
    }
  };
  const actions = {
    setView: (view: import("./session").ResearchSession["view"]) => send({ type: "view", view }),
    run: () => track(() => withResearchFiles("shared", run)),
    runGrid: (
      configs: JsgConfig[],
      axes: GridAxis[],
      source?: { connection: ClickHouseConnection; range: ClickHouseRange },
    ) => track(() => withResearchFiles("shared", () => runGrid(configs, axes, source))),
    viewGridResult: (index: number) =>
      track(() => withResearchFiles("shared", () => viewGridResult(index))),
    forgetGrid: () => {
      if (state.grid) send({ type: "entry-forgotten", kind: "grid", id: state.grid.run.id });
    },
    runValidation: (request: ValidationRequest) =>
      track(() => withResearchFiles("shared", () => runValidation(request))),
    forgetStudy: () => {
      if (state.study) send({ type: "entry-forgotten", kind: "study", id: state.study.run.id });
    },
    createExperiment,
    createProject: (name: string) => {
      if (active) return;
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
          [...state.projects, project],
          [...state.experiments, experiment],
          experiment.id,
        );
        selection++;
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
    selectExperiment: (id: string) => track(() => selectExperiment(id)),
    selectEntry: (kind: "run" | "grid" | "study", id: string) => track(() => selectEntry(kind, id)),
    forgetEntry: (kind: "run" | "grid" | "study", id: string) =>
      send(kind === "run" ? { type: "forgotten", id } : { type: "entry-forgotten", kind, id }),
    attachBenchmark: (runId: string, benchmark?: BenchmarkBinding) =>
      send({ type: "benchmark", runId, ...(benchmark ? { benchmark } : {}) }),
    connectAndRun: (connection: ClickHouseConnection, range: ClickHouseRange) =>
      track(() => withResearchFiles("shared", () => connectAndRun(connection, range))),
    importFiles: (files: readonly File[]) =>
      track(() => withResearchFiles("shared", () => importFiles(files))),
    getSession: () => state,
    flush: () => track(flush),
    useDataset: (dataset: ResearchDataset) =>
      track(() =>
        withResearchFiles("shared", async () => {
          if (active) throw new Error("请等待当前任务结束");
          const available = await readDataset(services, dataset);
          send({ type: "choose-dataset", dataset: available });
        }),
      ),
    forgetRun: (id: string) => send({ type: "forgotten", id }),
    cancel,
    selectRun: (id: string) => track(() => selectRun(id)),
    change: (patch: Partial<JsgConfig>) => send({ type: "draft", patch }),
    reset: (config: JsgConfig) => send({ type: "replace-draft", config }),
    useRunConfig: () => {
      if (state.selected) send({ type: "replace-draft", config: state.selected.run.config });
    },
    notice: (error: string | null, status?: string) =>
      send({ type: "notice", error, ...(status !== undefined ? { status } : {}) }),
  };
  return {
    actions,
    initialize,
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      if (!open) return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    close: () =>
      (closing ??= (async () => {
        open = false;
        clearTimeout(timer);
        selection++;
        active?.abort.abort();
        try {
          if (active?.handle) await Effect.runPromise(active.handle.cancel);
        } finally {
          await initializing;
          await Promise.allSettled(accepted);
          try {
            await flush();
          } finally {
            listeners.clear();
          }
        }
      })()),
  };
}
const servicesByArtifacts = new WeakMap<
  RuntimeServices["artifacts"],
  ReturnType<typeof createResearchService>
>();
export function researchService(services: RuntimeServices) {
  let service = servicesByArtifacts.get(services.artifacts);
  if (!service) {
    service = createResearchService(services);
    servicesByArtifacts.set(services.artifacts, service);
  }
  return service;
}
export async function closeResearchService(artifacts: RuntimeServices["artifacts"] | undefined) {
  if (!artifacts) return;
  const service = servicesByArtifacts.get(artifacts);
  try {
    await service?.close();
  } finally {
    servicesByArtifacts.delete(artifacts);
  }
}
