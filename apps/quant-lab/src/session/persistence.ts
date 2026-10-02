import type { RuntimeServices } from "@bcr/core";
import { parseManifest, type ResearchDataset } from "@bcr/market-data/research/model";
import {
  validateConfig,
  validateParameterSchedule,
  type JsgConfig,
  type JsgResult,
} from "@bcr/quant-core";
import { Effect } from "effect";
import { readJson, restoreResearch } from "../data/io";
import type { GridResult } from "../experiments/grid";
import {
  initialLibrary,
  validateLibrary,
  type ResearchExperiment,
  type ResearchProject,
} from "../experiments/model";
import type { ValidationResult } from "../experiments/validation";
import { copyConfig, datasetKey } from "./config";
import {
  MAX_RUNS,
  type DatasetRefs,
  type ResearchGrid,
  type ResearchRun,
  type ResearchSession,
  type SelectedGrid,
  type SelectedRun,
  type SelectedStudy,
} from "./model";

const MAX_SESSION_BYTES = 16 * 1024 * 1024;
type ResearchStorage = Pick<RuntimeServices, "artifacts" | "metadata">;
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
