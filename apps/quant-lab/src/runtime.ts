import {
  ArtifactStoreTag,
  artifactStore,
  contentHash,
  executorRegistry,
  Executors,
  memoryCacheStore,
  schedulerLive,
  schedulerLiveWithJournal,
  SchedulerTag,
  type ArtifactRef,
} from "@bcr/core";
import type { RuntimeServices } from "@bcr/react";
import { workerExecutor, WorkerPool } from "@bcr/runtime-worker";
import { isOpfsSupported, MemoryStore, OpfsStore } from "@bcr/storage-opfs";
import {
  openSqliteDb,
  sqliteCacheStore,
  sqliteLineageStore,
  sqliteTaskJournal,
  type SqliteDb,
} from "@bcr/storage-sqlite";
import initSqlite from "@sqlite.org/sqlite-wasm";
import wasmUrl from "@sqlite.org/sqlite-wasm/sqlite3.wasm?url";
import { Context, Effect, Layer } from "effect";
import { generateDemoMarket, parseMarketCsv } from "./engine";
import type {
  BacktestMetrics,
  BacktestResult,
  Dataset,
  EquityPoint,
  MarketBar,
  QuantOutputRefs,
  SignalPoint,
  StrategyConfig,
  Trade,
} from "./model";
import { quant } from "./store";

let metaDb: SqliteDb | undefined;

type SqliteInit = (options?: {
  locateFile?: (file: string) => string;
}) => Promise<Parameters<typeof openSqliteDb>[0]["sqlite3"]>;

async function openMetaDb(store: OpfsStore | MemoryStore): Promise<SqliteDb> {
  const init = initSqlite as unknown as SqliteInit;
  const sqlite3 = await init({ locateFile: () => wasmUrl });
  return openSqliteDb({ store, path: "project/meta.db", sqlite3 });
}

export async function createRuntimeServices(): Promise<RuntimeServices> {
  const opfs = isOpfsSupported() ? new OpfsStore("quant") : new MemoryStore();
  const memory = new MemoryStore();
  try {
    metaDb = await openMetaDb(opfs);
    quant.log("ok", "sqlite · project metadata online");
  } catch (error) {
    metaDb = undefined;
    quant.log("warn", `sqlite unavailable · ${String(error)}`);
  }

  const artifactContext = await Effect.runPromise(
    Effect.scoped(
      Layer.build(artifactStore({ memory, opfs }, metaDb && sqliteLineageStore(metaDb))),
    ),
  );
  const artifacts = Context.get(artifactContext, ArtifactStoreTag);
  const pool = new WorkerPool(
    {
      minSize: 1,
      maxSize: Math.max(1, (navigator.hardwareConcurrency ?? 2) - 1),
      idleTimeoutMs: 30_000,
    },
    () =>
      new Worker(new URL("./workers/quant.worker.ts", import.meta.url), {
        type: "module",
      }),
  );
  const executor = workerExecutor(pool, "js", "quant-engine-0.1.0", artifacts);
  const deps = Layer.mergeAll(
    Layer.succeed(ArtifactStoreTag, artifacts),
    metaDb !== undefined ? sqliteCacheStore(metaDb) : memoryCacheStore(),
    Layer.succeed(Executors, executorRegistry([executor])),
  );
  const schedulerLayer =
    metaDb !== undefined ? schedulerLiveWithJournal(sqliteTaskJournal(metaDb)) : schedulerLive;
  const context = await Effect.runPromise(
    Effect.scoped(Layer.build(Layer.provideMerge(schedulerLayer, deps))),
  );
  return { scheduler: Context.get(context, SchedulerTag), artifacts };
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function datasetFromBars(
  services: RuntimeServices,
  name: string,
  bars: ReadonlyArray<MarketBar>,
): Promise<Dataset> {
  const bytes = encoder.encode(JSON.stringify(bars));
  const hash = contentHash(bytes);
  const ref: ArtifactRef = {
    id: `market/${hash}`,
    type: "market/ohlcv",
    storage: "opfs",
    format: "json",
    hash,
  };
  await Effect.runPromise(services.artifacts.put(ref, bytes));
  const dataset = { name, ref, bars };
  quant.setDataset(dataset);
  quant.log("ok", `dataset · ${name} · ${bars.length} bars · ${hash.slice(0, 10)}`);
  return dataset;
}

export function loadDemoDataset(services: RuntimeServices): Promise<Dataset> {
  return datasetFromBars(services, "BCR-SYNTH / DAILY", generateDemoMarket());
}

export async function importCsvDataset(services: RuntimeServices, file: File): Promise<Dataset> {
  return datasetFromBars(services, file.name, parseMarketCsv(await file.text()));
}

async function readJson<T>(services: RuntimeServices, ref: ArtifactRef): Promise<T> {
  const bytes = await Effect.runPromise(services.artifacts.get(ref));
  return JSON.parse(decoder.decode(bytes)) as T;
}

interface PersistedProject {
  readonly dataset: { readonly name: string; readonly ref: ArtifactRef };
  readonly config: StrategyConfig;
  readonly outputs: QuantOutputRefs | null;
}

export async function persistProject(services: RuntimeServices): Promise<void> {
  const dataset = quant.getSnapshot().dataset;
  if (metaDb === undefined || dataset === null) return;
  const state = quant.getSnapshot();
  const project: PersistedProject = {
    dataset: { name: dataset.name, ref: dataset.ref },
    config: state.config,
    outputs: state.outputRefs,
  };
  try {
    await metaDb.kvSet("project", JSON.stringify(project));
  } catch (error) {
    quant.log("warn", `persist project failed · ${String(error)}`);
  }
  void services;
}

export async function restoreProject(services: RuntimeServices): Promise<boolean> {
  if (metaDb === undefined) return false;
  try {
    const raw = await metaDb.kvGet("project");
    if (raw === undefined) return false;
    const project = JSON.parse(raw) as PersistedProject;
    const bars = await readJson<ReadonlyArray<MarketBar>>(services, project.dataset.ref);
    quant.setDataset({ name: project.dataset.name, ref: project.dataset.ref, bars });
    quant.setConfig(project.config);
    if (project.outputs !== null) {
      const [signals, equity, trades, metrics] = await Promise.all([
        readJson<ReadonlyArray<SignalPoint>>(services, project.outputs.signals),
        readJson<ReadonlyArray<EquityPoint>>(services, project.outputs.equity),
        readJson<ReadonlyArray<Trade>>(services, project.outputs.trades),
        readJson<BacktestMetrics>(services, project.outputs.metrics),
      ]);
      const result: BacktestResult = { equity, trades, metrics };
      quant.restoreResult(signals, result, project.outputs);
    }
    quant.log("info", `restore · ${project.dataset.name} · ${bars.length} bars`);
    return true;
  } catch (error) {
    quant.log("warn", `restore project failed · ${String(error)}`);
    return false;
  }
}
