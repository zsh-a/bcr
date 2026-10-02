import type { ArtifactRef } from "@bcr/core";
import type { BenchmarkBinding } from "@bcr/market-data/research/benchmark";
import { type ResearchDataset } from "@bcr/market-data/research/model";
import { type JsgConfig, type JsgResult, type ParameterStep } from "@bcr/quant-core";
import type { ReplayVersions } from "../execution/versions";
import type { GridAxis, GridResult } from "../experiments/grid";
import { type ResearchExperiment, type ResearchProject } from "../experiments/model";
import type { ValidationResult } from "../experiments/validation";

export const MAX_RUNS = 1000;
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
    validationMode?: import("../experiments/validation").ValidationRequest["mode"];
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
