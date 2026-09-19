import {
  contentHash,
  hashReadableStream,
  type ArtifactCleanupCandidate,
  type ArtifactCleanupPlan,
  type ArtifactCleanupResult,
  type ArtifactInventoryEntry,
  type ArtifactRef,
  type ArtifactStorageUsage,
  type ArtifactUsage,
  type ComputeTask,
  type TaskHandle,
} from "@bcr/core";
import {
  dataTableStats,
  decodeDataTablePackage,
  type DataFormat,
  type DataTablePackage,
} from "@bcr/data-core";
import type { RuntimeServices } from "@bcr/react";
import { Effect, Fiber, Stream } from "effect";

const SNAPSHOT_KEY = "data-studio.snapshot.v1";
const CATALOG_KEY = "data-studio.catalog.v1";
let taskSequence = 0;
let activeTask: TaskHandle | null = null;

export interface DataAssetRecord {
  readonly id: string;
  readonly sourceName: string;
  readonly format: DataFormat;
  readonly sizeBytes: number;
  readonly sourceRef: ArtifactRef;
  readonly tableRef: ArtifactRef;
  readonly rowCount: number;
  readonly columnCount: number;
  readonly sampled: boolean;
  readonly createdAt: number;
  readonly lastOpenedAt: number;
  readonly sourceHash?: string | undefined;
}

export interface DataAssetCatalog {
  readonly version: 1;
  readonly activeAssetId: string | null;
  readonly assets: ReadonlyArray<DataAssetRecord>;
}

export interface DataTableSnapshot {
  readonly table: DataTablePackage;
  readonly sourceRef: ArtifactRef;
  readonly tableRef: ArtifactRef;
  readonly sizeBytes?: number | undefined;
  readonly asset?: DataAssetRecord | undefined;
}

export interface RestoredDataCatalog {
  readonly catalog: DataAssetCatalog;
  readonly active: DataTableSnapshot | undefined;
  /** True when the previous single-snapshot metadata was upgraded in memory. */
  readonly migratedLegacy: boolean;
}

export interface DataStorageReport {
  readonly usage: ArtifactUsage;
  readonly dataUsage: ArtifactStorageUsage;
  readonly catalogObjectCount: number;
  readonly orphaned: ReadonlyArray<ArtifactCleanupCandidate>;
  readonly plan: ArtifactCleanupPlan;
}

function formatForFile(file: Pick<File, "name" | "type">): DataFormat {
  const extension = file.name.split(".").pop()?.toLocaleLowerCase() ?? "";
  if (extension === "ndjson" || extension === "jsonl") return "ndjson";
  if (extension === "json" || file.type.toLocaleLowerCase().includes("json")) return "json";
  if (extension === "csv" || file.type.toLocaleLowerCase().includes("csv")) return "csv";
  throw new Error("Data Studio 目前支持 CSV、JSON 数组和 NDJSON 文件");
}

function isArtifactRef(value: unknown): value is ArtifactRef {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ArtifactRef>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.type === "string" &&
    (candidate.storage === "memory" ||
      candidate.storage === "shared-memory" ||
      candidate.storage === "opfs")
  );
}

function sourceRefFor(file: File, hash: string, format: DataFormat): ArtifactRef {
  return {
    id: `data/source/${hash}`,
    type: `file/${format}`,
    storage: "opfs",
    format: file.type || format,
    hash,
  };
}

function tableTask(sourceRef: ArtifactRef, file: File, format: DataFormat): ComputeTask {
  taskSequence += 1;
  return {
    id: `data-table-${Date.now().toString(36)}-${taskSequence.toString(36)}`,
    runtime: "js",
    operation: "data.parse.table",
    inputs: [{ ...sourceRef, port: "source" }],
    outputs: [
      {
        name: "table",
        type: "data/table",
        storage: "opfs",
        format: "json",
      },
    ],
    resources: { memoryMB: 256, threads: 1 },
    cache: { enabled: true },
    config: {
      format,
      sourceName: file.name,
      sizeBytes: file.size,
    },
  };
}

function outputRef(outputs: ReadonlyArray<ArtifactRef>): ArtifactRef {
  const ref = outputs.find((candidate) => candidate.type === "data/table") ?? outputs[0];
  if (ref === undefined) throw new Error("Data parser 没有返回 table Artifact");
  return ref;
}

function emptyCatalog(): DataAssetCatalog {
  return { version: 1, activeAssetId: null, assets: [] };
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isDataFormat(value: unknown): value is DataFormat {
  return value === "csv" || value === "json" || value === "ndjson";
}

function decodeDataAsset(value: unknown): DataAssetRecord | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate["id"] !== "string" ||
    typeof candidate["sourceName"] !== "string" ||
    !isDataFormat(candidate["format"]) ||
    !isNonNegativeInteger(candidate["sizeBytes"]) ||
    !isArtifactRef(candidate["sourceRef"]) ||
    !isArtifactRef(candidate["tableRef"]) ||
    !isNonNegativeInteger(candidate["rowCount"]) ||
    !isNonNegativeInteger(candidate["columnCount"]) ||
    typeof candidate["sampled"] !== "boolean" ||
    !isFiniteNumber(candidate["createdAt"]) ||
    !isFiniteNumber(candidate["lastOpenedAt"])
  ) {
    return undefined;
  }
  const sourceHash = candidate["sourceHash"];
  return {
    id: candidate["id"],
    sourceName: candidate["sourceName"],
    format: candidate["format"],
    sizeBytes: candidate["sizeBytes"],
    sourceRef: candidate["sourceRef"],
    tableRef: candidate["tableRef"],
    rowCount: candidate["rowCount"],
    columnCount: candidate["columnCount"],
    sampled: candidate["sampled"],
    createdAt: candidate["createdAt"],
    lastOpenedAt: candidate["lastOpenedAt"],
    ...(typeof sourceHash === "string" && sourceHash.length > 0 ? { sourceHash } : {}),
  };
}

function decodeDataCatalog(value: unknown): DataAssetCatalog | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  if (candidate["version"] !== 1 || !Array.isArray(candidate["assets"])) return undefined;
  const assets = candidate["assets"].flatMap((asset) => {
    const decoded = decodeDataAsset(asset);
    return decoded === undefined ? [] : [decoded];
  });
  const activeAssetId = candidate["activeAssetId"];
  if (activeAssetId !== null && typeof activeAssetId !== "string") return undefined;
  return { version: 1, activeAssetId, assets };
}

function assetIdFor(sourceRef: ArtifactRef): string {
  return `data-asset/${sourceRef.hash ?? sourceRef.id}`;
}

function assetFromSnapshot(
  snapshot: DataTableSnapshot,
  previous?: DataAssetRecord,
): DataAssetRecord {
  const stats = dataTableStats(snapshot.table);
  const sourceHash = snapshot.sourceRef.hash ?? snapshot.table.provenance.sourceHash;
  return {
    id: previous?.id ?? assetIdFor(snapshot.sourceRef),
    sourceName: snapshot.table.sourceName,
    format: snapshot.table.format,
    sizeBytes: snapshot.sizeBytes ?? previous?.sizeBytes ?? 0,
    sourceRef: snapshot.sourceRef,
    tableRef: snapshot.tableRef,
    rowCount: stats.rowCount,
    columnCount: stats.columnCount,
    sampled: snapshot.table.provenance.sampled,
    createdAt: previous?.createdAt ?? snapshot.table.provenance.createdAt,
    lastOpenedAt: Date.now(),
    ...(sourceHash === undefined ? {} : { sourceHash }),
  };
}

async function readSnapshotRefs(
  services: RuntimeServices,
  sourceRef: ArtifactRef,
  tableRef: ArtifactRef,
  sizeBytes?: number,
  asset?: DataAssetRecord,
): Promise<DataTableSnapshot | undefined> {
  try {
    const bytes = await Effect.runPromise(services.artifacts.get(tableRef));
    const table = decodeDataTablePackage(JSON.parse(new TextDecoder().decode(bytes)) as unknown);
    return table === undefined
      ? undefined
      : {
          table,
          sourceRef,
          tableRef,
          ...(sizeBytes === undefined ? {} : { sizeBytes }),
          ...(asset === undefined ? {} : { asset }),
        };
  } catch {
    return undefined;
  }
}

function legacyRefs(
  raw: string | undefined,
): { readonly sourceRef: ArtifactRef; readonly tableRef: ArtifactRef } | undefined {
  if (raw === undefined || raw.length === 0) return undefined;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parsed["version"] === 1 &&
      isArtifactRef(parsed["sourceRef"]) &&
      isArtifactRef(parsed["tableRef"])
      ? { sourceRef: parsed["sourceRef"], tableRef: parsed["tableRef"] }
      : undefined;
  } catch {
    return undefined;
  }
}

async function readDataCatalog(
  services: RuntimeServices,
): Promise<{ readonly catalog: DataAssetCatalog; readonly migratedLegacy: boolean }> {
  if (services.metadata === undefined) return { catalog: emptyCatalog(), migratedLegacy: false };
  const catalogRaw = await services.metadata.get(CATALOG_KEY);
  let decoded: DataAssetCatalog | undefined;
  if (catalogRaw !== undefined && catalogRaw.length > 0) {
    try {
      decoded = decodeDataCatalog(JSON.parse(catalogRaw) as unknown);
    } catch {
      decoded = undefined;
    }
  }
  if (decoded !== undefined) return { catalog: decoded, migratedLegacy: false };
  const legacy = legacyRefs(await services.metadata.get(SNAPSHOT_KEY));
  if (legacy === undefined) return { catalog: emptyCatalog(), migratedLegacy: false };
  const snapshot = await readSnapshotRefs(services, legacy.sourceRef, legacy.tableRef);
  if (snapshot === undefined) return { catalog: emptyCatalog(), migratedLegacy: false };
  const asset = assetFromSnapshot(snapshot);
  return {
    catalog: { version: 1, activeAssetId: asset.id, assets: [asset] },
    migratedLegacy: true,
  };
}

async function writeDataCatalog(
  services: RuntimeServices,
  catalog: DataAssetCatalog,
): Promise<void> {
  if (services.metadata === undefined) return;
  await services.metadata.set(CATALOG_KEY, JSON.stringify(catalog));
  const active = catalog.assets.find((asset) => asset.id === catalog.activeAssetId);
  await services.metadata.set(
    SNAPSHOT_KEY,
    active === undefined
      ? ""
      : JSON.stringify({ version: 1, sourceRef: active.sourceRef, tableRef: active.tableRef }),
  );
}

function isDataArtifactId(id: string): boolean {
  return id === "data" || id.startsWith("data/");
}

function dataUsage(entries: ReadonlyArray<ArtifactInventoryEntry>): ArtifactStorageUsage {
  return entries.reduce(
    (total, entry) => ({
      storage: "data",
      objects: total.objects + 1,
      bytes: total.bytes + entry.size,
    }),
    { storage: "data", objects: 0, bytes: 0 },
  );
}

/**
 * Build a cleanup plan scoped to Data Studio's `data/` namespace.
 *
 * ArtifactStore's generic cleanup scans every workspace. We protect every
 * non-data object plus all catalog roots, then expose only untracked data
 * candidates so a Data Studio action cannot reclaim Reader/Manga artifacts.
 */
export async function inspectDataStorage(services: RuntimeServices): Promise<DataStorageReport> {
  const loaded = await readDataCatalog(services);
  const inventory = await Effect.runPromise(services.artifacts.inventory());
  const catalogIds = new Set(
    loaded.catalog.assets.flatMap((asset) => [asset.sourceRef.id, asset.tableRef.id]),
  );
  const protectedIds = inventory
    .filter((entry) => !isDataArtifactId(entry.id) || catalogIds.has(entry.id))
    .map((entry) => entry.id);
  const genericPlan = await Effect.runPromise(services.artifacts.planCleanup({ protectedIds }));
  const orphaned = genericPlan.candidates.filter((entry) => isDataArtifactId(entry.id));
  const plan: ArtifactCleanupPlan = { ...genericPlan, candidates: orphaned };
  const usage = {
    totalObjects: inventory.length,
    totalBytes: inventory.reduce((total, entry) => total + entry.size, 0),
    byStorage: inventory.reduce<ReadonlyArray<ArtifactStorageUsage>>((totals, entry) => {
      const current = totals.find((item) => item.storage === entry.storage);
      if (current === undefined) {
        return [...totals, { storage: entry.storage, objects: 1, bytes: entry.size }];
      }
      return totals.map((item) =>
        item.storage === entry.storage
          ? { ...item, objects: item.objects + 1, bytes: item.bytes + entry.size }
          : item,
      );
    }, []),
  } satisfies ArtifactUsage;
  return {
    usage,
    dataUsage: dataUsage(inventory.filter((entry) => isDataArtifactId(entry.id))),
    catalogObjectCount: catalogIds.size,
    orphaned,
    plan,
  };
}

/** Reclaim only the data-scoped candidates from a previously inspected plan. */
export async function reclaimDataStorage(
  services: RuntimeServices,
  plan: ArtifactCleanupPlan,
): Promise<ArtifactCleanupResult> {
  const scopedPlan = {
    ...plan,
    candidates: plan.candidates.filter((entry) => isDataArtifactId(entry.id)),
  };
  return Effect.runPromise(services.artifacts.reclaim(scopedPlan));
}

/** Import and parse a table through the host Scheduler/compute.worker. */
export async function importDataTable(
  services: RuntimeServices,
  file: File,
  onProgress?: (progress: number) => void,
): Promise<DataTableSnapshot> {
  const format = formatForFile(file);
  const hash = await hashReadableStream(file.stream());
  const sourceRef = sourceRefFor(file, hash, format);
  await Effect.runPromise(services.artifacts.putStream(sourceRef, file.stream()));
  const task = tableTask(sourceRef, file, format);
  const handle = await Effect.runPromise(services.scheduler.submit(task));
  activeTask = handle;
  const progressFiber = Effect.runFork(
    Stream.runForEach(handle.events, (event) =>
      Effect.sync(() => {
        if (event.type === "progress") onProgress?.(event.value);
      }),
    ),
  );
  try {
    const outputs = await Effect.runPromise(handle.await);
    const tableRef = outputRef(outputs);
    const bytes = await Effect.runPromise(services.artifacts.get(tableRef));
    const table = decodeDataTablePackage(JSON.parse(new TextDecoder().decode(bytes)) as unknown);
    if (table === undefined) throw new Error("Data parser 返回了无效的 table Artifact");
    const snapshot = {
      table,
      sourceRef,
      tableRef,
      sizeBytes: file.size,
    } satisfies DataTableSnapshot;
    await persistDataTable(services, snapshot);
    onProgress?.(1);
    return { ...snapshot, asset: assetFromSnapshot(snapshot) };
  } finally {
    activeTask = null;
    Effect.runFork(Fiber.interrupt(progressFiber));
  }
}

export async function cancelDataTableImport(): Promise<void> {
  const task = activeTask;
  if (task === null) return;
  await Effect.runPromise(task.cancel);
  activeTask = null;
}

export async function persistDataTable(
  services: RuntimeServices,
  snapshot: DataTableSnapshot,
): Promise<void> {
  if (services.metadata === undefined) return;
  const current = await readDataCatalog(services);
  const existing = current.catalog.assets.find(
    (asset) => asset.id === assetIdFor(snapshot.sourceRef),
  );
  const asset = assetFromSnapshot(snapshot, existing);
  const assets = [
    asset,
    ...current.catalog.assets.filter((candidate) => candidate.id !== asset.id),
  ];
  await writeDataCatalog(services, { version: 1, activeAssetId: asset.id, assets });
}

/** Restore one immutable table Artifact referenced by an asset catalog entry. */
export async function restoreDataAsset(
  services: RuntimeServices,
  asset: DataAssetRecord,
): Promise<DataTableSnapshot | undefined> {
  return readSnapshotRefs(services, asset.sourceRef, asset.tableRef, asset.sizeBytes, asset);
}

/**
 * Restore the asset catalog and its most recently selected table. Invalid
 * table artifacts are left in the catalog for diagnostics, while a healthy
 * sibling can still become the active view.
 */
export async function restoreDataCatalog(services: RuntimeServices): Promise<RestoredDataCatalog> {
  const loaded = await readDataCatalog(services);
  const preferred = loaded.catalog.assets.find(
    (asset) => asset.id === loaded.catalog.activeAssetId,
  );
  const candidates = [
    ...(preferred === undefined ? [] : [preferred]),
    ...loaded.catalog.assets
      .filter((asset) => asset.id !== preferred?.id)
      .toSorted((left, right) => right.lastOpenedAt - left.lastOpenedAt),
  ];
  let active: DataTableSnapshot | undefined;
  for (const asset of candidates) {
    active = await restoreDataAsset(services, asset);
    if (active !== undefined) break;
  }
  const activeAssetId = active?.asset?.id ?? loaded.catalog.activeAssetId;
  const catalog =
    activeAssetId === loaded.catalog.activeAssetId
      ? loaded.catalog
      : { ...loaded.catalog, activeAssetId };
  if (loaded.migratedLegacy || catalog.activeAssetId !== loaded.catalog.activeAssetId) {
    await writeDataCatalog(services, catalog);
  }
  return { catalog, active, migratedLegacy: loaded.migratedLegacy };
}

/** Select an asset, update its last-opened timestamp, and persist the active ID. */
export async function activateDataAsset(
  services: RuntimeServices,
  assetId: string,
): Promise<DataTableSnapshot | undefined> {
  const loaded = await readDataCatalog(services);
  const asset = loaded.catalog.assets.find((candidate) => candidate.id === assetId);
  if (asset === undefined) return undefined;
  const snapshot = await restoreDataAsset(services, asset);
  if (snapshot === undefined) return undefined;
  const opened = { ...asset, lastOpenedAt: Date.now() };
  const assets = [opened, ...loaded.catalog.assets.filter((candidate) => candidate.id !== assetId)];
  await writeDataCatalog(services, { version: 1, activeAssetId: assetId, assets });
  return { ...snapshot, asset: opened };
}

/** Remove an asset from the active catalog without deleting immutable Artifacts. */
export async function removeDataAsset(
  services: RuntimeServices,
  assetId: string,
): Promise<DataAssetCatalog> {
  const loaded = await readDataCatalog(services);
  const assets = loaded.catalog.assets.filter((asset) => asset.id !== assetId);
  const nextActive =
    loaded.catalog.activeAssetId === assetId
      ? (assets[0]?.id ?? null)
      : loaded.catalog.activeAssetId !== null &&
          assets.some((asset) => asset.id === loaded.catalog.activeAssetId)
        ? loaded.catalog.activeAssetId
        : (assets[0]?.id ?? null);
  const catalog = { version: 1 as const, activeAssetId: nextActive, assets };
  await writeDataCatalog(services, catalog);
  return catalog;
}

/** Restore the legacy single-table view by selecting the catalog's active asset. */
export async function restoreDataTable(
  services: RuntimeServices,
): Promise<DataTableSnapshot | undefined> {
  return (await restoreDataCatalog(services)).active;
}

export async function clearDataTable(services: RuntimeServices): Promise<void> {
  const restored = await restoreDataCatalog(services);
  const activeAssetId = restored.catalog.activeAssetId;
  if (activeAssetId === null) {
    if (services.metadata !== undefined) await services.metadata.set(SNAPSHOT_KEY, "");
    return;
  }
  await removeDataAsset(services, activeAssetId);
}

export function dataContentHash(table: DataTablePackage): string {
  return contentHash(new TextEncoder().encode(JSON.stringify(table)));
}
