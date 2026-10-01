import type { ArtifactRef, RuntimeServices } from "@bcr/core";
import { Effect } from "effect";
import { readJson, restoreResearch } from "./data";
import {
  DEFAULT_CONFIG,
  MODEL,
  parseManifest,
  validateConfig,
  type JsgConfig,
  type JsgResult,
  type ResearchDataset,
} from "./model";

export const MAX_RUNS = 20;
type ResearchStorage = Pick<RuntimeServices, "artifacts" | "metadata">;
export type DatasetRefs = Pick<ResearchDataset, "manifestRef" | "partitions" | "snapshot">;
export interface ResearchRun {
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
export interface ResearchOperation {
  id: string;
  kind: "import" | "load" | "backtest";
  label: string;
  progress: number | null;
}
export interface ResearchSession {
  ready: boolean;
  dataset: ResearchDataset | null;
  draft: JsgConfig;
  runs: ResearchRun[];
  selected: SelectedRun | null;
  operation: ResearchOperation | null;
  status: string;
  error: string | null;
}
export function copyConfig(config: JsgConfig): JsgConfig {
  return structuredClone(config);
}
export function configKey(c: JsgConfig): string {
  return JSON.stringify({
    executionModel: c.executionModel ?? MODEL,
    initialCapital: c.initialCapital,
    poolSize: c.poolSize,
    stockCount: c.stockCount,
    commissionBps: c.commissionBps,
    slippageBps: c.slippageBps,
    stopLoss: c.stopLoss,
    trailingStop: c.trailingStop,
    maxDrawdown: c.maxDrawdown,
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
    ready: false,
    dataset: null,
    draft: copyConfig(DEFAULT_CONFIG),
    runs: [],
    selected: null,
    operation: null,
    status: "正在恢复研究…",
    error: null,
  };
}
export type SessionEvent =
  | { type: "choose-dataset"; dataset: ResearchDataset }
  | { type: "restored"; value: Pick<ResearchSession, "dataset" | "draft" | "runs" | "selected"> }
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
  | { type: "stopped"; id: string; error?: string }
  | { type: "selected"; selected: SelectedRun }
  | { type: "notice"; error: string | null; status?: string }
  | { type: "forgotten"; id: string };
export function sessionReducer(state: ResearchSession, event: SessionEvent): ResearchSession {
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
            runs: [
              ...state.runs.filter((r) => r.id !== event.selected.run.id),
              event.selected.run,
            ].slice(-MAX_RUNS),
            status: `回测完成 · ${event.selected.result.metrics.days} 个交易日${event.selected.run.cached ? " · 复用已有结果" : ""}`,
            error: null,
          }
        : state;
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
      return { ...state, selected: event.selected, error: null };
    case "notice":
      return { ...state, error: event.error, status: event.status ?? state.status };
    case "forgotten":
      return {
        ...state,
        runs: state.runs.filter((r) => r.id !== event.id),
        selected: state.selected?.run.id === event.id ? null : state.selected,
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
    version: 2,
    dataset: register(refs(state.dataset)),
    datasets,
    draft: state.draft,
    runs: state.runs.slice(-MAX_RUNS).map((run) => ({ ...run, dataset: register(run.dataset) })),
    selectedId: state.selected?.run.id ?? null,
  });
  if (saved.length > 4 * 1024 * 1024) throw new Error("本地研究记录过大");
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
export async function restoreSession(
  services: ResearchStorage,
): Promise<Pick<ResearchSession, "dataset" | "draft" | "runs" | "selected"> | null> {
  const raw = await services.metadata?.get(KEY);
  if (raw !== undefined) {
    if (raw.length > 4 * 1024 * 1024) throw new Error("本地研究记录过大");
    const saved = JSON.parse(raw) as {
      version: number;
      dataset: DatasetRefs | number;
      datasets?: DatasetRefs[];
      draft: JsgConfig;
      runs: (Omit<ResearchRun, "dataset"> & { dataset: DatasetRefs | number })[];
      selectedId: string | null;
    };
    if (saved.version !== 2 || !Array.isArray(saved.runs) || saved.runs.length > MAX_RUNS)
      throw new Error("本地研究记录格式无效");
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
    return { dataset, draft: copyConfig(saved.draft), runs, selected };
  }
  const old = await restoreResearch(services);
  if (old === null) return null;
  if (old.resultRef === null)
    return { dataset: old.dataset, draft: copyConfig(old.config), runs: [], selected: null };
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
    dataset: old.dataset,
    draft: copyConfig(old.config),
    runs: [run],
    selected: { run, dataset: old.dataset, result },
  };
}
