import { DEFAULT_CONFIG, MODEL } from "@bcr/quant-core";
import { DEFAULT_EXPERIMENT_ID, initialLibrary, validateLibrary } from "../experiments/model";
import { copyConfig } from "./config";
import { type ResearchEvent, type ResearchRun, type ResearchSession } from "./model";

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
