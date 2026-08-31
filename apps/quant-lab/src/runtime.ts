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
import { decodeMarketArrow } from "./arrow";
import { columnarizeMarketBars, readMarketParquet, type ColumnarDatasetPayload } from "./columnar";
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
  const executor = workerExecutor(pool, "js", "quant-engine-0.2.0-arrow", artifacts);
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

const decoder = new TextDecoder();

async function persistColumnarDataset(
  services: RuntimeServices,
  name: string,
  payload: ColumnarDatasetPayload,
): Promise<Dataset> {
  const arrowHash = contentHash(payload.arrow);
  const ref: ArtifactRef = {
    id: `market/arrow/${arrowHash}`,
    type: "market/ohlcv+arrow",
    storage: "opfs",
    format: "arrow-ipc",
    hash: arrowHash,
  };
  const parquetHash = contentHash(payload.parquet);
  const parquetRef: ArtifactRef = {
    id: `market/parquet/${parquetHash}`,
    type: "market/ohlcv+parquet",
    storage: "opfs",
    format: "parquet",
    hash: parquetHash,
  };
  await Promise.all([
    Effect.runPromise(services.artifacts.put(ref, payload.arrow)),
    Effect.runPromise(services.artifacts.put(parquetRef, payload.parquet)),
  ]);
  const dataset = {
    name,
    ref,
    parquetRef,
    bars: payload.bars,
    columnar: payload.metadata,
  } satisfies Dataset;
  quant.setDataset(dataset);
  quant.log(
    "ok",
    `columnar · ${name} · ${payload.bars.length} rows · Arrow ${formatBytes(payload.arrow.byteLength)} · Parquet ${formatBytes(payload.parquet.byteLength)}`,
  );
  return dataset;
}

async function datasetFromBars(
  services: RuntimeServices,
  name: string,
  bars: ReadonlyArray<MarketBar>,
  source: "demo" | "csv" | "legacy-json",
): Promise<Dataset> {
  return persistColumnarDataset(services, name, await columnarizeMarketBars(bars, source));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function loadDemoDataset(services: RuntimeServices): Promise<Dataset> {
  return datasetFromBars(services, "BCR-SYNTH / DAILY", generateDemoMarket(), "demo");
}

export async function importCsvDataset(services: RuntimeServices, file: File): Promise<Dataset> {
  return datasetFromBars(services, file.name, parseMarketCsv(await file.text()), "csv");
}

export async function importMarketDataset(services: RuntimeServices, file: File): Promise<Dataset> {
  if (file.name.toLowerCase().endsWith(".parquet")) {
    const payload = await readMarketParquet(new Uint8Array(await file.arrayBuffer()));
    return persistColumnarDataset(services, file.name, payload);
  }
  return importCsvDataset(services, file);
}

export async function readDatasetParquet(services: RuntimeServices): Promise<Uint8Array> {
  const dataset = quant.getSnapshot().dataset;
  if (dataset?.parquetRef === null || dataset?.parquetRef === undefined) {
    throw new Error("当前数据集没有 Parquet Artifact");
  }
  return Effect.runPromise(services.artifacts.get(dataset.parquetRef));
}

async function readJson<T>(services: RuntimeServices, ref: ArtifactRef): Promise<T> {
  const bytes = await Effect.runPromise(services.artifacts.get(ref));
  return JSON.parse(decoder.decode(bytes)) as T;
}

interface PersistedProject {
  readonly dataset: {
    readonly name: string;
    readonly ref: ArtifactRef;
    readonly parquetRef?: ArtifactRef | null;
    readonly columnar?: Dataset["columnar"];
  };
  readonly config: StrategyConfig;
  readonly outputs: QuantOutputRefs | null;
}

export async function persistProject(services: RuntimeServices): Promise<void> {
  const dataset = quant.getSnapshot().dataset;
  if (metaDb === undefined || dataset === null) return;
  const state = quant.getSnapshot();
  const project: PersistedProject = {
    dataset: {
      name: dataset.name,
      ref: dataset.ref,
      parquetRef: dataset.parquetRef,
      columnar: dataset.columnar,
    },
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
    const sourceBytes = await Effect.runPromise(services.artifacts.get(project.dataset.ref));
    let dataset: Dataset;
    if (project.dataset.ref.format === "json") {
      const bars = JSON.parse(decoder.decode(sourceBytes)) as ReadonlyArray<MarketBar>;
      dataset = await datasetFromBars(services, project.dataset.name, bars, "legacy-json");
      quant.log("info", "migration · JSON market artifact → Arrow IPC + Parquet");
    } else {
      const bars = decodeMarketArrow(sourceBytes);
      const parquetBytes =
        project.dataset.parquetRef === undefined || project.dataset.parquetRef === null
          ? 0
          : (await Effect.runPromise(services.artifacts.get(project.dataset.parquetRef)))
              .byteLength;
      dataset = {
        name: project.dataset.name,
        ref: project.dataset.ref,
        parquetRef: project.dataset.parquetRef ?? null,
        bars,
        columnar: project.dataset.columnar ?? {
          source: "legacy-json",
          engine: "Arrow 17 · restored",
          arrowBytes: sourceBytes.byteLength,
          parquetBytes,
          rowCount: bars.length,
          minDate: bars[0]?.date ?? "",
          maxDate: bars.at(-1)?.date ?? "",
          averageVolume: bars.reduce((sum, bar) => sum + bar.volume, 0) / Math.max(1, bars.length),
        },
      };
      quant.setDataset(dataset);
    }
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
    quant.log("info", `restore · ${project.dataset.name} · ${dataset.bars.length} bars`);
    if (project.dataset.ref.format === "json") await persistProject(services);
    return true;
  } catch (error) {
    quant.log("warn", `restore project failed · ${String(error)}`);
    return false;
  }
}
