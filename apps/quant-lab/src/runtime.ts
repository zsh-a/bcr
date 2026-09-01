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
import type { QuantHandoff } from "@bcr/market-data";
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
import {
  generateDemoMarket,
  parseMarketCsv,
  partitionMarketBarsByYear,
  validateMarketBars,
} from "./engine";
import type {
  BacktestMetrics,
  BacktestResult,
  ColumnarMetadata,
  Dataset,
  EquityPoint,
  MarketBar,
  MarketPartition,
  MarketHandoffSummary,
  PortfolioAnalysis,
  QuantOutputRefs,
  SignalPoint,
  StrategyConfig,
  Trade,
} from "./model";
import { buildPortfolioAnalysis, isPortfolioAnalysis } from "./portfolio";
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
  const jsExecutor = workerExecutor(pool, "js", "quant-signals-0.2.0-arrow", artifacts);
  const wasmExecutor = workerExecutor(pool, "wasm", "bcr-kernels-quant-0.3.0", artifacts);
  const deps = Layer.mergeAll(
    Layer.succeed(ArtifactStoreTag, artifacts),
    metaDb !== undefined ? sqliteCacheStore(metaDb) : memoryCacheStore(),
    Layer.succeed(Executors, executorRegistry([jsExecutor, wasmExecutor])),
  );
  const schedulerLayer =
    metaDb !== undefined ? schedulerLiveWithJournal(sqliteTaskJournal(metaDb)) : schedulerLive;
  const context = await Effect.runPromise(
    Effect.scoped(Layer.build(Layer.provideMerge(schedulerLayer, deps))),
  );
  return { scheduler: Context.get(context, SchedulerTag), artifacts };
}

const decoder = new TextDecoder();
const encoder = new TextEncoder();

interface PartitionManifest {
  readonly version: 1;
  readonly schema: "ohlcv-v1";
  readonly partitioning: "year";
  readonly rowCount: number;
  readonly partitions: ReadonlyArray<MarketPartition>;
}

function arrowRef(key: string, bytes: Uint8Array): ArtifactRef {
  const hash = contentHash(bytes);
  return {
    id: `market/partitions/${key}/arrow/${hash}`,
    type: "market/ohlcv+arrow",
    storage: "opfs",
    format: "arrow-ipc",
    hash,
  };
}

function parquetRef(id: string, bytes: Uint8Array): ArtifactRef {
  const hash = contentHash(bytes);
  return {
    id: `market/${id}/parquet/${hash}`,
    type: "market/ohlcv+parquet",
    storage: "opfs",
    format: "parquet",
    hash,
  };
}

async function persistColumnarDataset(
  services: RuntimeServices,
  name: string,
  payload: ColumnarDatasetPayload,
): Promise<Dataset> {
  const partitions: MarketPartition[] = [];
  for (const group of partitionMarketBarsByYear(payload.bars)) {
    const partitionPayload = await columnarizeMarketBars(group.bars, payload.metadata.source, 1);
    const ref = arrowRef(group.key, partitionPayload.arrow);
    const compactRef = parquetRef(`partitions/${group.key}`, partitionPayload.parquet);
    await Promise.all([
      Effect.runPromise(services.artifacts.put(ref, partitionPayload.arrow)),
      Effect.runPromise(services.artifacts.put(compactRef, partitionPayload.parquet)),
    ]);
    partitions.push({
      key: group.key,
      rowCount: group.bars.length,
      minDate: group.bars[0]?.date ?? "",
      maxDate: group.bars.at(-1)?.date ?? "",
      arrowBytes: partitionPayload.arrow.byteLength,
      parquetBytes: partitionPayload.parquet.byteLength,
      ref,
      parquetRef: compactRef,
    });
  }

  const exportRef = parquetRef("exports", payload.parquet);
  await Effect.runPromise(services.artifacts.put(exportRef, payload.parquet));
  const manifest: PartitionManifest = {
    version: 1,
    schema: "ohlcv-v1",
    partitioning: "year",
    rowCount: payload.bars.length,
    partitions,
  };
  const manifestBytes = encoder.encode(JSON.stringify(manifest));
  const manifestHash = contentHash(manifestBytes);
  const ref: ArtifactRef = {
    id: `market/manifests/${manifestHash}`,
    type: "market/partition-manifest",
    storage: "opfs",
    format: "json",
    hash: manifestHash,
  };
  await Effect.runPromise(services.artifacts.put(ref, manifestBytes));
  const arrowBytes = partitions.reduce((sum, partition) => sum + partition.arrowBytes, 0);
  const parquetBytes = partitions.reduce((sum, partition) => sum + partition.parquetBytes, 0);
  const dataset = {
    name,
    ref,
    parquetRef: exportRef,
    partitions,
    bars: payload.bars,
    columnar: {
      ...payload.metadata,
      arrowBytes,
      parquetBytes,
      partitionCount: partitions.length,
    },
  } satisfies Dataset;
  quant.setDataset(dataset);
  quant.log(
    "ok",
    `columnar · ${name} · ${payload.bars.length} rows / ${partitions.length} yearly partitions · Arrow ${formatBytes(arrowBytes)} · Parquet ${formatBytes(parquetBytes)}`,
  );
  return dataset;
}

async function datasetFromBars(
  services: RuntimeServices,
  name: string,
  bars: ReadonlyArray<MarketBar>,
  source: ColumnarMetadata["source"],
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

export async function importMarketAtlasHandoff(
  services: RuntimeServices,
  handoff: QuantHandoff,
): Promise<Dataset> {
  const series =
    handoff.version === 2
      ? handoff.series
      : [
          {
            instrument: handoff.instrument,
            range: handoff.range,
            bars: handoff.bars,
            source: handoff.source,
          },
        ];
  const primary = series[0];
  if (primary === undefined || primary.bars.length === 0) {
    throw new Error("Market Atlas handoff has no usable series");
  }
  const bars = primary.bars.map((bar) => ({
    date: bar.date,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
  }));
  const dataset = await datasetFromBars(
    services,
    handoff.version === 2
      ? `${handoff.groupName} · ${primary.instrument.shortName} +${Math.max(0, series.length - 1)} · ${primary.range} / MARKET ATLAS`
      : `${primary.instrument.shortName} · ${primary.range} / MARKET ATLAS`,
    bars,
    "market-atlas",
  );
  const summary: MarketHandoffSummary = {
    version: 1,
    createdAt: handoff.createdAt,
    groupId: handoff.version === 2 ? handoff.groupId : null,
    groupName: handoff.version === 2 ? handoff.groupName : primary.instrument.shortName,
    range: primary.range,
    series: series.map((item) => ({
      instrumentId: item.instrument.id,
      symbol: item.instrument.symbol,
      name: item.instrument.name,
      market: item.instrument.market,
      range: item.range,
      bars: item.bars.length,
      source: item.source,
    })),
  };
  quant.setMarketHandoff(summary);
  if (handoff.version === 2) {
    try {
      const portfolioSeries = series.map((item) => ({
        instrumentId: item.instrument.id,
        symbol: item.instrument.symbol,
        name: item.instrument.name,
        market: item.instrument.market,
        bars: item.bars.map((bar) => ({
          date: bar.date,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          volume: bar.volume,
        })),
      }));
      quant.setPortfolioAnalysis(
        buildPortfolioAnalysis(portfolioSeries, {
          initialCapital: quant.getSnapshot().config.initialCapital,
          feeBps: quant.getSnapshot().config.feeBps,
        }),
      );
      quant.log(
        "ok",
        `portfolio · ${portfolioSeries.length} series · equal-weight correlation and benchmark ready`,
      );
    } catch (error) {
      quant.setPortfolioAnalysis(null);
      quant.log(
        "warn",
        `portfolio · analysis unavailable · ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return dataset;
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
    readonly partitions?: ReadonlyArray<MarketPartition>;
    readonly columnar?: Dataset["columnar"];
  };
  readonly config: StrategyConfig;
  readonly outputs: QuantOutputRefs | null;
  readonly marketHandoff?: MarketHandoffSummary | null;
  readonly portfolioAnalysis?: PortfolioAnalysis | null;
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
    marketHandoff: state.marketHandoff,
    portfolioAnalysis: state.portfolioAnalysis,
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
    let dataset: Dataset;
    let migrated = false;
    let restoredPartitions = project.dataset.partitions;
    if (project.dataset.ref.type === "market/partition-manifest") {
      const manifest = await readJson<PartitionManifest>(services, project.dataset.ref);
      const manifestRows = manifest.partitions.reduce(
        (sum, partition) => sum + partition.rowCount,
        0,
      );
      if (
        manifest.version !== 1 ||
        manifest.schema !== "ohlcv-v1" ||
        manifest.partitioning !== "year" ||
        manifest.partitions.length === 0 ||
        manifestRows !== manifest.rowCount
      ) {
        throw new Error("年度分区清单无效");
      }
      restoredPartitions = manifest.partitions;
    }
    if (restoredPartitions !== undefined && restoredPartitions.length > 0) {
      const chunks = await Promise.all(
        [...restoredPartitions]
          .sort((left, right) => left.key.localeCompare(right.key))
          .map(async (partition) =>
            decodeMarketArrow(await Effect.runPromise(services.artifacts.get(partition.ref)), 1),
          ),
      );
      const bars = validateMarketBars(chunks.flat());
      const partitions = restoredPartitions;
      dataset = {
        name: project.dataset.name,
        ref: project.dataset.ref,
        parquetRef: project.dataset.parquetRef ?? null,
        partitions,
        bars,
        columnar: project.dataset.columnar ?? {
          source: "legacy-json",
          engine: "Arrow 17 · restored partition manifest",
          arrowBytes: partitions.reduce((sum, item) => sum + item.arrowBytes, 0),
          parquetBytes: partitions.reduce((sum, item) => sum + item.parquetBytes, 0),
          partitionCount: partitions.length,
          rowCount: bars.length,
          minDate: bars[0]?.date ?? "",
          maxDate: bars.at(-1)?.date ?? "",
          averageVolume: bars.reduce((sum, bar) => sum + bar.volume, 0) / Math.max(1, bars.length),
        },
      };
      quant.setDataset(dataset);
    } else {
      const sourceBytes = await Effect.runPromise(services.artifacts.get(project.dataset.ref));
      const bars =
        project.dataset.ref.format === "json"
          ? (JSON.parse(decoder.decode(sourceBytes)) as ReadonlyArray<MarketBar>)
          : decodeMarketArrow(sourceBytes);
      const existingParquet =
        project.dataset.parquetRef === undefined || project.dataset.parquetRef === null
          ? undefined
          : await Effect.runPromise(services.artifacts.get(project.dataset.parquetRef));
      if (existingParquet === undefined) {
        dataset = await datasetFromBars(services, project.dataset.name, bars, "legacy-json");
      } else {
        dataset = await persistColumnarDataset(services, project.dataset.name, {
          bars,
          arrow: sourceBytes,
          parquet: existingParquet,
          metadata: {
            source: project.dataset.columnar?.source ?? "legacy-json",
            engine: project.dataset.columnar?.engine ?? "Arrow 17 · migrated",
            arrowBytes: sourceBytes.byteLength,
            parquetBytes: existingParquet.byteLength,
            partitionCount: 1,
            rowCount: bars.length,
            minDate: bars[0]?.date ?? "",
            maxDate: bars.at(-1)?.date ?? "",
            averageVolume:
              bars.reduce((sum, bar) => sum + bar.volume, 0) / Math.max(1, bars.length),
          },
        });
      }
      migrated = true;
      quant.log("info", "migration · single market artifact → yearly partition manifest");
    }
    quant.setConfig(project.config);
    if (
      project.marketHandoff?.version === 1 &&
      Array.isArray(project.marketHandoff.series) &&
      project.marketHandoff.series.length > 0
    ) {
      quant.setMarketHandoff(project.marketHandoff);
    }
    if (project.portfolioAnalysis !== undefined && isPortfolioAnalysis(project.portfolioAnalysis)) {
      quant.setPortfolioAnalysis(project.portfolioAnalysis);
    }
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
    if (migrated) await persistProject(services);
    return true;
  } catch (error) {
    quant.log("warn", `restore project failed · ${String(error)}`);
    return false;
  }
}
