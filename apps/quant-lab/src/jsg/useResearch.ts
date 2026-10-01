import type { RuntimeServices, TaskHandle } from "@bcr/core";
import { Effect } from "effect";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { importResearch, readJson } from "./data";
import { demoResearch } from "./demo";
import { withResearchFiles } from "./file-lease";
import { rememberSnapshot, recoverResearchFiles, researchStore } from "./storage";
import { loadFromBrowser } from "./clickhouse-browser";
import type { ClickHouseConnection, ClickHouseRange } from "./clickhouse-http";
import {
  DEFAULT_CONFIG,
  MODEL,
  validateConfig,
  type JsgConfig,
  type JsgResult,
  type ResearchDataset,
} from "./model";
import {
  copyConfig,
  initialSession,
  readRun,
  readDataset,
  restoreSession,
  saveSession,
  sessionReducer,
  type ResearchRun,
  type SessionEvent,
} from "./session";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
interface Active {
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
  const send = useCallback((event: SessionEvent) => {
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
  }, [services, send, state.ready, state.dataset, state.draft, state.runs, state.selected]);
  const start = (kind: "import" | "load" | "backtest", label: string): Active | null => {
    if (active.current !== null || !current.current.ready) return null;
    const token = { id: crypto.randomUUID(), abort: new AbortController(), handle: null };
    active.current = token;
    send({ type: "started", operation: { id: token.id, kind, label, progress: null } });
    return token;
  };
  const progress = (
    token: Active,
    label: string,
    value: number | null,
    kind?: "load" | "backtest",
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
    const strategy = copyConfig(config);
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
        id: token.id,
        createdAt: new Date().toISOString(),
        config: strategy,
        dataset: { manifestRef: dataset.manifestRef, partitions: dataset.partitions },
        name: dataset.manifest.name,
        startDate: dataset.manifest.startDate,
        endDate: dataset.manifest.endDate,
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
      const loaded = await loadFromBrowser(connection, range, token.abort.signal, (value) => {
        progress(token, value.text, value.total ? value.completed / value.total : null);
      });
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
  const selectRun = async (id: string) => {
    const run = current.current.runs.find((item) => item.id === id);
    if (!run) return;
    const request = ++selection.current;
    setSelecting(true);
    try {
      const selected = await readRun(services, run);
      if (selection.current === request) send({ type: "selected", selected });
    } catch (error) {
      if (selection.current === request) send({ type: "notice", error: message(error) });
    } finally {
      if (selection.current === request && mounted.current) setSelecting(false);
    }
  };
  return {
    state,
    selecting,
    run: () => withResearchFiles("shared", run),
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
