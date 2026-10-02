import { type RuntimeServices } from "@bcr/core";
import type { BenchmarkBinding } from "@bcr/market-data/research/benchmark";
import type {
  ClickHouseConnection,
  ClickHouseRange,
} from "@bcr/market-data/research/clickhouse-http";
import { withResearchFiles } from "@bcr/market-data/research/file-lease";
import { type ResearchDataset } from "@bcr/market-data/research/model";
import { DEFAULT_CONFIG, validateConfig, type JsgConfig } from "@bcr/quant-core";
import { Effect } from "effect";
import { demoResearch } from "../data/demo";
import { importResearch } from "../data/io";
import { recoverResearchFiles, rememberSnapshot, researchStore } from "../data/storage";
import type { OperationContext, OperationToken } from "../execution/operation-context";
import { createBacktestOperations } from "../execution/operations";
import { type GridAxis } from "../experiments/grid";
import {
  DEFAULT_EXPERIMENT_ID,
  validateLibrary,
  type ResearchExperiment,
} from "../experiments/model";
import { type ValidationRequest } from "../experiments/validation";
import { createValidationOperation } from "../experiments/validation-run";
import { copyConfig } from "./config";
import {
  MAX_RUNS,
  type ResearchEvent,
  type ResearchOperation,
  type ResearchSession,
} from "./model";
import {
  readDataset,
  readGrid,
  readRun,
  readStudy,
  restoreSession,
  saveSession,
} from "./persistence";
import { initialSession, sessionReducer } from "./reducer";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
export interface ResearchSnapshot {
  state: ResearchSession;
  selecting: boolean;
}
export type ResearchController = ReturnType<typeof createResearchService>["actions"] &
  ResearchSnapshot;
/** Domain orchestration owns persistence and operations independently of any React view. */
export function createResearchService(services: RuntimeServices) {
  const binary = services.binary ?? researchStore();
  let state = initialSession();
  let active: OperationToken | null = null;
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
  const start = (kind: ResearchOperation["kind"], label: string): OperationToken | null => {
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
    token: OperationToken,
    label: string,
    value: number | null,
    kind?: "load" | "backtest" | "grid",
  ) => {
    token.abort.signal.throwIfAborted();
    send({ type: "progress", id: token.id, label, progress: value, ...(kind ? { kind } : {}) });
  };
  const stop = (token: OperationToken, error?: unknown) => {
    if (active === token) active = null;
    send({
      type: "stopped",
      id: token.id,
      ...(token.abort.signal.aborted || error === undefined ? {} : { error: message(error) }),
    });
  };
  const operationContext: OperationContext = {
    services,
    binary,
    getState: () => state,
    start,
    progress,
    send,
    stop,
    release: (token) => {
      if (active === token) active = null;
    },
    resetSelection: () => {
      selection++;
      setSelecting(false);
    },
  };
  const { run, importFiles, connectAndRun, runGrid, viewGridResult } =
    createBacktestOperations(operationContext);
  const runValidation = createValidationOperation(operationContext);
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
          const grid = await readGrid(services, run as import("./model").ResearchGrid);
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
    setView: (view: import("./model").ResearchSession["view"]) => send({ type: "view", view }),
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
