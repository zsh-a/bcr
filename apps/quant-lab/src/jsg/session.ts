import type { ArtifactRef, RuntimeServices } from "@bcr/core";
import { Effect } from "effect";
import { readJson, restoreResearch } from "./data";
import type { GridAxis, GridResult } from "./grid";
import type { BenchmarkBinding } from "./benchmark";
import type { ReplayVersions } from "./versions";
import type { ValidationResult } from "./validation";
import {
  DEFAULT_CONFIG,
  MODEL,
  parseManifest,
  validateConfig,
  type JsgConfig,
  type JsgResult,
  type ResearchDataset,
  strategySpec,
  validateParameterSchedule,
  type ParameterStep,
} from "./model";
import {
  DEFAULT_EXPERIMENT_ID,
  initialLibrary,
  validateLibrary,
  type ResearchExperiment,
  type ResearchProject,
} from "./experiments";

export const MAX_RUNS = 1000;
const MAX_SESSION_BYTES = 16 * 1024 * 1024;
type ResearchStorage = Pick<RuntimeServices, "artifacts" | "metadata">;
export type DatasetRefs = Pick<ResearchDataset, "manifestRef" | "partitions" | "snapshot">;
export interface ResearchRun {
  parameterSchedule?: ParameterStep[];
  experimentId?: string;
  versions?: ReplayVersions;
  benchmark?: BenchmarkBinding;
  snapshot?: ResearchDataset["snapshot"];
  id: string;
  createdAt: string;
  config: JsgConfig;
  dataset: DatasetRefs;
  name: string;
  startDate: number;
  endDate: number;
  resultRef: ArtifactRef;
  metrics: JsgResult["metrics"];
  durationMs: number | null;
  cached: boolean;
}
export interface SelectedRun {
  run: ResearchRun;
  dataset: ResearchDataset;
  result: JsgResult;
}
export type ResearchGrid = Omit<ResearchRun, "config" | "metrics"> & { axes: GridAxis[] };
export interface SelectedGrid {
  run: ResearchGrid;
  dataset: ResearchDataset;
  result: GridResult;
}
export interface SelectedStudy {
  run: Omit<ResearchRun, "config" | "metrics"> & {
    validationMode?: import("./validation").ValidationRequest["mode"];
  };
  dataset: ResearchDataset;
  result: ValidationResult;
}
export interface ResearchOperation {
  id: string;
  kind: "import" | "load" | "backtest" | "grid";
  label: string;
  progress: number | null;
}
export interface ResearchSession {
  view: "run" | "grid" | "study";
  projects: ResearchProject[];
  experiments: ResearchExperiment[];
  experimentId: string;
  grids: ResearchGrid[];
  studies: SelectedStudy["run"][];
  ready: boolean;
  dataset: ResearchDataset | null;
  draft: JsgConfig;
  runs: ResearchRun[];
  selected: SelectedRun | null;
  grid?: SelectedGrid | null;
  study?: SelectedStudy | null;
  operation: ResearchOperation | null;
  status: string;
  error: string | null;
}
export function copyConfig(config: JsgConfig): JsgConfig {
  return structuredClone(config);
}
export function configKey(c: JsgConfig): string {
  return JSON.stringify({
    strategy: strategySpec(c),
    ...(c.researchWindow
      ? { researchWindow: { start: c.researchWindow.start, end: c.researchWindow.end } }
      : {}),
    executionModel: c.executionModel ?? MODEL,
    initialCapital: c.initialCapital,
    poolSize: c.poolSize,
    stockCount: c.stockCount,
    commissionBps: c.commissionBps,
    slippageBps: c.slippageBps,
    stopLoss: c.stopLoss,
    trailingStop: c.trailingStop,
    maxDrawdown: c.maxDrawdown,
    maxPositionPct: c.maxPositionPct ?? 0,
    maxExposurePct: c.maxExposurePct ?? 0,
    maxDailyLoss: c.maxDailyLoss ?? 0,
    takeProfit: c.takeProfit ?? 0,
    tPlusOne: c.tPlusOne,
    industryBlacklist: [...c.industryBlacklist].sort(),
    participation: c.participation ?? 0.1,
    fees: (c.fees ?? []).map((f) => ({
      from: f.from,
      commissionBps: f.commissionBps ?? null,
      minimumCommission: f.minimumCommission,
      transferBps: f.transferBps,
      sellTaxBps: f.sellTaxBps,
    })),
  });
}
export function datasetKey(d: DatasetRefs): string {
  return JSON.stringify([
    d.manifestRef.hash ?? d.manifestRef.id,
    ...d.partitions.map((p) => p.hash ?? p.id),
  ]);
}
/** Explicit defaults give single and grid detail jobs the same task-cache identity. */
export function canonicalConfig(config: JsgConfig): JsgConfig {
  return JSON.parse(configKey(config)) as JsgConfig;
}
export function isDraftChanged(state: ResearchSession): boolean {
  const run = state.selected?.run;
  return (
    run !== undefined &&
    (configKey(state.draft) !== configKey(run.config) ||
      state.dataset === null ||
      datasetKey(state.dataset) !== datasetKey(run.dataset))
  );
}
export function initialSession(): ResearchSession {
  return {
    ...initialLibrary(),
    view: "run",
    grids: [],
    studies: [],
    ready: false,
    dataset: null,
    draft: copyConfig(DEFAULT_CONFIG),
    runs: [],
    selected: null,
    grid: null,
    operation: null,
    status: "正在恢复研究…",
    error: null,
  };
}
export type SessionEvent =
  | { type: "choose-dataset"; dataset: ResearchDataset }
  | {
      type: "restored";
      value: Pick<ResearchSession, "dataset" | "draft" | "runs" | "selected" | "grid" | "study"> &
        Partial<
          Pick<
            ResearchSession,
            "projects" | "experiments" | "experimentId" | "grids" | "studies" | "view"
          >
        >;
    }
  | { type: "ready"; dataset?: ResearchDataset; error?: string }
  | { type: "draft"; patch: Partial<JsgConfig> }
  | { type: "replace-draft"; config: JsgConfig }
  | { type: "started"; operation: ResearchOperation }
  | {
      type: "progress";
      id: string;
      label: string;
      progress: number | null;
      kind?: ResearchOperation["kind"];
    }
  | { type: "dataset"; id: string; dataset: ResearchDataset; draft?: JsgConfig }
  | { type: "finished"; id: string; selected: SelectedRun }
  | { type: "grid-finished"; id: string; grid: SelectedGrid }
  | { type: "forget-grid" }
  | { type: "study-finished"; id: string; study: SelectedStudy }
  | { type: "forget-study" }
  | { type: "benchmark"; runId: string; benchmark?: BenchmarkBinding }
  | { type: "stopped"; id: string; error?: string }
  | { type: "selected"; selected: SelectedRun }
  | { type: "notice"; error: string | null; status?: string }
  | { type: "forgotten"; id: string };
type LibraryEvent =
  | { type: "view"; view: ResearchSession["view"] }
  | { type: "project-created"; project: ResearchProject; experiment: ResearchExperiment }
  | { type: "experiment-created"; experiment: ResearchExperiment }
  | { type: "experiment-selected"; id: string }
  | {
      type: "experiment-updated";
      id: string;
      patch: Partial<
        Pick<ResearchExperiment, "name" | "notes" | "tags" | "favorite" | "baselineId">
      >;
    }
  | { type: "project-renamed"; id: string; name: string }
  | { type: "grid-selected"; grid: SelectedGrid }
  | { type: "study-selected"; study: SelectedStudy }
  | { type: "entry-forgotten"; kind: "grid" | "study"; id: string };
export type ResearchEvent = SessionEvent | LibraryEvent;
export function sessionReducer(state: ResearchSession, event: ResearchEvent): ResearchSession {
  switch (event.type) {
    case "choose-dataset":
      return {
        ...state,
        dataset: event.dataset,
        draft:
          event.dataset.manifest.version === 1 && state.draft.executionModel === "jsg-raw-v2"
            ? { ...state.draft, executionModel: MODEL, fees: [] }
            : state.draft,
        error: null,
      };
    case "restored":
      return { ...state, ...event.value, ready: true, status: "已恢复本地研究" };
    case "ready":
      return {
        ...state,
        ready: true,
        dataset: event.dataset ?? state.dataset,
        error: event.error ?? null,
        status: event.error ? "研究恢复失败" : "演示数据就绪",
      };
    case "draft":
      return { ...state, draft: copyConfig({ ...state.draft, ...event.patch }), error: null };
    case "replace-draft":
      return { ...state, draft: copyConfig(event.config), error: null };
    case "started":
      return state.operation === null
        ? { ...state, operation: event.operation, error: null, status: event.operation.label }
        : state;
    case "progress":
      return state.operation?.id === event.id
        ? {
            ...state,
            operation: {
              ...state.operation,
              label: event.label,
              progress: event.progress,
              kind: event.kind ?? state.operation.kind,
            },
            status: event.label,
          }
        : state;
    case "dataset":
      return state.operation?.id === event.id
        ? { ...state, dataset: event.dataset, draft: event.draft ?? state.draft }
        : state;
    case "finished":
      return state.operation?.id === event.id
        ? {
            ...state,
            operation: null,
            selected: event.selected,
            view: "run",
            runs: [...state.runs.filter((r) => r.id !== event.selected.run.id), event.selected.run],
            status: `回测完成 · ${event.selected.result.metrics.days} 个交易日${event.selected.run.cached ? " · 复用已有结果" : ""}`,
            error: null,
          }
        : state;
    case "grid-finished":
      return state.operation?.id === event.id
        ? {
            ...state,
            operation: null,
            grid: event.grid,
            view: "grid",
            grids: [...state.grids.filter((r) => r.id !== event.grid.run.id), event.grid.run],
            error: null,
            status: `参数实验完成 · ${event.grid.result.results.length} 组${event.grid.run.cached ? " · 复用已有结果" : ""}`,
          }
        : state;
    case "forget-grid":
      return { ...state, grid: null, view: "run" };
    case "study-finished":
      return state.operation?.id === event.id
        ? {
            ...state,
            operation: null,
            study: event.study,
            view: "study",
            studies: [...state.studies.filter((r) => r.id !== event.study.run.id), event.study.run],
            error: null,
            status: "稳健性验证完成",
          }
        : state;
    case "forget-study":
      return { ...state, study: null, view: "run" };
    case "benchmark": {
      const patch = (run: ResearchRun): ResearchRun => {
        if (run.id !== event.runId) return run;
        const { benchmark: _benchmark, ...remaining } = run;
        return event.benchmark ? { ...remaining, benchmark: event.benchmark } : remaining;
      };
      return {
        ...state,
        runs: state.runs.map(patch),
        selected: state.selected ? { ...state.selected, run: patch(state.selected.run) } : null,
      };
    }
    case "stopped":
      return state.operation?.id === event.id
        ? {
            ...state,
            operation: null,
            error: event.error ?? null,
            status: event.error ? "任务未完成，已有结果保留" : "已取消，已有结果保留",
          }
        : state;
    case "selected":
      return {
        ...state,
        selected: event.selected,
        view: "run",
        experimentId: event.selected.run.experimentId ?? DEFAULT_EXPERIMENT_ID,
        grid: null,
        study: null,
        error: null,
      };
    case "notice":
      return { ...state, error: event.error, status: event.status ?? state.status };
    case "forgotten":
      return {
        ...state,
        runs: state.runs.filter((r) => r.id !== event.id),
        selected: state.selected?.run.id === event.id ? null : state.selected,
        experiments: state.experiments.map((e) =>
          e.baselineId === event.id ? { ...e, baselineId: null } : e,
        ),
      };
    case "view":
      return { ...state, view: event.view };
    case "project-created":
      return {
        ...state,
        projects: [...state.projects, event.project],
        experiments: [...state.experiments, event.experiment],
        experimentId: event.experiment.id,
        view: "run",
        selected: null,
        grid: null,
        study: null,
      };
    case "experiment-created":
      return {
        ...state,
        experiments: [...state.experiments, event.experiment],
        experimentId: event.experiment.id,
        view: "run",
        selected: null,
        grid: null,
        study: null,
      };
    case "experiment-selected":
      return state.experiments.some((e) => e.id === event.id)
        ? { ...state, experimentId: event.id, selected: null, grid: null, study: null, view: "run" }
        : state;
    case "experiment-updated": {
      const experiments = state.experiments.map((e) =>
        e.id === event.id ? { ...e, ...event.patch } : e,
      );
      validateLibrary(state.projects, experiments, state.experimentId);
      for (const e of experiments)
        if (
          e.baselineId &&
          !state.runs.some(
            (r) => r.id === e.baselineId && (r.experimentId ?? DEFAULT_EXPERIMENT_ID) === e.id,
          )
        )
          throw new Error("基线必须来自同一实验的完整回测");
      return { ...state, experiments };
    }
    case "project-renamed": {
      const projects = state.projects.map((p) =>
        p.id === event.id ? { ...p, name: event.name } : p,
      );
      validateLibrary(projects, state.experiments, state.experimentId);
      return { ...state, projects };
    }
    case "grid-selected":
      return {
        ...state,
        experimentId: event.grid.run.experimentId ?? DEFAULT_EXPERIMENT_ID,
        grid: event.grid,
        view: "grid",
        study: null,
        error: null,
      };
    case "study-selected":
      return {
        ...state,
        experimentId: event.study.run.experimentId ?? DEFAULT_EXPERIMENT_ID,
        study: event.study,
        view: "study",
        grid: null,
        error: null,
      };
    case "entry-forgotten":
      return event.kind === "grid"
        ? {
            ...state,
            grids: state.grids.filter((r) => r.id !== event.id),
            grid: state.grid?.run.id === event.id ? null : (state.grid ?? null),
            view: state.grid?.run.id === event.id && state.view === "grid" ? "run" : state.view,
          }
        : {
            ...state,
            studies: state.studies.filter((r) => r.id !== event.id),
            study: state.study?.run.id === event.id ? null : (state.study ?? null),
            view: state.study?.run.id === event.id && state.view === "study" ? "run" : state.view,
          };
  }
}

const KEY = "jsg-session-v2";
const refs = (dataset: ResearchDataset): DatasetRefs => ({
  ...(dataset.snapshot ? { snapshot: dataset.snapshot } : {}),
  manifestRef: dataset.manifestRef,
  partitions: dataset.partitions,
});
export async function saveSession(
  services: ResearchStorage,
  state: ResearchSession,
): Promise<void> {
  if (state.dataset === null) return;
  validateConfig(state.draft);
  validateLibrary(state.projects, state.experiments, state.experimentId);
  if (Math.max(state.runs.length, state.grids.length, state.studies.length) > MAX_RUNS)
    throw new Error("研究目录已满，请手动移除不需要的记录");
  const datasets: DatasetRefs[] = [],
    datasetIds = new Map<string, number>();
  const register = (dataset: DatasetRefs) => {
    const key = datasetKey(dataset),
      existing = datasetIds.get(key);
    if (existing !== undefined) return existing;
    const index = datasets.length;
    datasets.push({
      manifestRef: dataset.manifestRef,
      partitions: dataset.partitions,
      ...(dataset.snapshot ? { snapshot: dataset.snapshot } : {}),
    });
    datasetIds.set(key, index);
    return index;
  };
  const saved = JSON.stringify({
    version: 3,
    view: state.view,
    projects: state.projects,
    experiments: state.experiments,
    experimentId: state.experimentId,
    dataset: register(refs(state.dataset)),
    datasets,
    draft: state.draft,
    runs: state.runs.map((run) => ({ ...run, dataset: register(run.dataset) })),
    grids: [
      ...new Map(
        [...state.grids, ...(state.grid ? [state.grid.run] : [])].map((r) => [r.id, r]),
      ).values(),
    ].map((run) => ({ ...run, dataset: register(run.dataset) })),
    studies: [
      ...new Map(
        [...state.studies, ...(state.study ? [state.study.run] : [])].map((r) => [r.id, r]),
      ).values(),
    ].map((run) => ({ ...run, dataset: register(run.dataset) })),
    ...(state.grid
      ? { grid: { ...state.grid.run, dataset: register(state.grid.run.dataset) } }
      : {}),
    ...(state.study
      ? { study: { ...state.study.run, dataset: register(state.study.run.dataset) } }
      : {}),
    selectedId: state.selected?.run.id ?? null,
  });
  if (saved.length > MAX_SESSION_BYTES) throw new Error("本地研究记录过大");
  await services.metadata?.set(KEY, saved);
}
export async function readDataset(
  services: ResearchStorage,
  dataset: DatasetRefs,
): Promise<ResearchDataset> {
  const manifest = parseManifest(await readJson<unknown>(services, dataset.manifestRef));
  if (dataset.partitions.length !== manifest.partitions.length)
    throw new Error("本地数据快照不完整，请重新获取数据");
  for (const ref of dataset.partitions)
    if (!(await Effect.runPromise(services.artifacts.has(ref))))
      throw new Error("本地数据文件已被移除，请重新获取数据");
  return { ...dataset, manifest };
}
export async function readRun(services: ResearchStorage, run: ResearchRun): Promise<SelectedRun> {
  const [dataset, result] = await Promise.all([
    readDataset(services, run.dataset),
    readJson<JsgResult>(services, run.resultRef),
  ]);
  return { run, dataset: run.snapshot ? { ...dataset, snapshot: run.snapshot } : dataset, result };
}
export type RestoredSession = Pick<
  ResearchSession,
  | "dataset"
  | "draft"
  | "runs"
  | "selected"
  | "grid"
  | "study"
  | "projects"
  | "experiments"
  | "experimentId"
  | "grids"
  | "studies"
  | "view"
>;
export async function readGrid(
  services: ResearchStorage,
  run: ResearchGrid,
): Promise<SelectedGrid> {
  const [dataset, result] = await Promise.all([
    readDataset(services, run.dataset),
    readJson<GridResult>(services, run.resultRef),
  ]);
  if (!Array.isArray(result.results) || !result.results.length || result.results.length > 64)
    throw new Error("本地参数实验结果无效");
  for (const row of result.results) validateConfig(row.config);
  return { run, dataset: run.snapshot ? { ...dataset, snapshot: run.snapshot } : dataset, result };
}
export async function readStudy(
  services: ResearchStorage,
  run: SelectedStudy["run"],
): Promise<SelectedStudy> {
  const [dataset, result] = await Promise.all([
    readDataset(services, run.dataset),
    readJson<ValidationResult>(services, run.resultRef),
  ]);
  if (
    ![1, 2].includes(result.version) ||
    !Array.isArray(result.folds) ||
    result.folds.length > 64 ||
    !Array.isArray(result.training) ||
    result.training.length > 64 ||
    !Array.isArray(result.costs)
  )
    throw new Error("本地验证结果格式无效");
  validateConfig(result.costBase);
  for (const fold of result.folds) validateConfig(fold.config);
  if (result.continuous) {
    const c = result.continuous;
    validateParameterSchedule(dataset.manifest, c.config, c.schedule);
    if (
      c.schedule.length !== result.folds.length ||
      !Array.isArray(c.deployed) ||
      c.deployed.length !== result.folds.length ||
      !c.result?.metrics ||
      !c.evaluation?.strategy
    )
      throw new Error("本地连续验证结果无效");
    for (const ref of [c.resultRef, ...(c.result.chunks ?? []).map((chunk) => chunk.ref)])
      if (!(await Effect.runPromise(services.artifacts.has(ref))))
        throw new Error("连续回放结果文件已被移除");
  }
  return { run, dataset: run.snapshot ? { ...dataset, snapshot: run.snapshot } : dataset, result };
}
export async function restoreSession(services: ResearchStorage): Promise<RestoredSession | null> {
  const raw = await services.metadata?.get(KEY);
  if (raw !== undefined) {
    if (raw.length > MAX_SESSION_BYTES) throw new Error("本地研究记录过大");
    const saved = JSON.parse(raw) as {
      version: number;
      view?: ResearchSession["view"];
      projects?: ResearchProject[];
      experiments?: ResearchExperiment[];
      experimentId?: string;
      grids?: (Omit<ResearchGrid, "dataset"> & { dataset: DatasetRefs | number })[];
      studies?: (Omit<SelectedStudy["run"], "dataset"> & { dataset: DatasetRefs | number })[];
      dataset: DatasetRefs | number;
      datasets?: DatasetRefs[];
      draft: JsgConfig;
      runs: (Omit<ResearchRun, "dataset"> & { dataset: DatasetRefs | number })[];
      selectedId: string | null;
      grid?: Omit<ResearchGrid, "dataset"> & { dataset: DatasetRefs | number };
      study?: Omit<SelectedStudy["run"], "dataset"> & { dataset: DatasetRefs | number };
    };
    if (
      ![2, 3].includes(saved.version) ||
      !Array.isArray(saved.runs) ||
      saved.runs.length > MAX_RUNS
    )
      throw new Error("本地研究记录格式无效");
    const library =
      saved.version === 3
        ? {
            projects: saved.projects!,
            experiments: saved.experiments!,
            experimentId: saved.experimentId!,
          }
        : initialLibrary();
    validateLibrary(library.projects, library.experiments, library.experimentId);
    validateConfig(saved.draft);
    const resolveDataset = (value: DatasetRefs | number): DatasetRefs => {
      const target = typeof value === "number" ? saved.datasets?.[value] : value;
      if (
        !target ||
        !Array.isArray(target.partitions) ||
        target.partitions.length > 20_000 ||
        !target.manifestRef
      )
        throw new Error("本地数据引用无效");
      return target;
    };
    const dataset = await readDataset(services, resolveDataset(saved.dataset));
    const runs: ResearchRun[] = saved.runs.flatMap((run) => {
      try {
        validateConfig(run.config);
        if (
          typeof run.id !== "string" ||
          !Number.isFinite(Date.parse(run.createdAt)) ||
          run.resultRef.type !== "quant/jsg-result"
        )
          return [];
        return [{ ...run, dataset: resolveDataset(run.dataset) }];
      } catch {
        return [];
      }
    });
    const active = runs.find((run) => run.id === saved.selectedId);
    const selected = active === undefined ? null : await readRun(services, active);
    const resolveEntries = <T extends SelectedStudy["run"]>(
      entries: (Omit<T, "dataset"> & { dataset: DatasetRefs | number })[],
      type: string,
    ): T[] => {
      if (!Array.isArray(entries) || entries.length > MAX_RUNS) throw new Error("研究记录格式无效");
      const ids = new Set<string>();
      return entries.map((entry) => {
        if (
          !entry.id ||
          ids.has(entry.id) ||
          entry.resultRef?.type !== type ||
          !Number.isFinite(Date.parse(entry.createdAt)) ||
          (entry.experimentId && !library.experiments.some((e) => e.id === entry.experimentId))
        )
          throw new Error("研究记录引用无效");
        ids.add(entry.id);
        return { ...entry, dataset: resolveDataset(entry.dataset) } as T;
      });
    };
    const grids = resolveEntries<ResearchGrid>(
      saved.grids ?? (saved.grid ? [saved.grid] : []),
      "quant/jsg-grid-result",
    );
    for (const run of grids)
      if (!Array.isArray(run.axes) || run.axes.length > 6) throw new Error("本地参数实验格式无效");
    const studies = resolveEntries<SelectedStudy["run"]>(
      saved.studies ?? (saved.study ? [saved.study] : []),
      "quant/jsg-study-result",
    );
    const gridRun = grids.find((r) => r.id === saved.grid?.id),
      studyRun = studies.find((r) => r.id === saved.study?.id);
    const grid = gridRun ? await readGrid(services, gridRun) : null;
    const study = studyRun ? await readStudy(services, studyRun) : null;
    return {
      ...library,
      view:
        saved.view === "grid" && grid ? "grid" : saved.view === "study" && study ? "study" : "run",
      grids,
      studies,
      dataset,
      draft: copyConfig(saved.draft),
      runs,
      selected,
      grid,
      study,
    };
  }
  const old = await restoreResearch(services);
  if (old === null) return null;
  if (old.resultRef === null)
    return {
      ...initialLibrary(),
      view: "run",
      grids: [],
      studies: [],
      dataset: old.dataset,
      draft: copyConfig(old.config),
      runs: [],
      selected: null,
    };
  const result = await readJson<JsgResult>(services, old.resultRef);
  const run: ResearchRun = {
    id: `restored-${old.resultRef.hash ?? old.resultRef.id}`,
    createdAt: new Date().toISOString(),
    config: copyConfig(old.config),
    dataset: refs(old.dataset),
    name: old.dataset.manifest.name,
    startDate: old.dataset.manifest.startDate,
    endDate: old.dataset.manifest.endDate,
    resultRef: old.resultRef,
    metrics: result.metrics,
    durationMs: null,
    cached: false,
  };
  return {
    ...initialLibrary(),
    view: "run",
    grids: [],
    studies: [],
    dataset: old.dataset,
    draft: copyConfig(old.config),
    runs: [run],
    selected: { run, dataset: old.dataset, result },
  };
}
