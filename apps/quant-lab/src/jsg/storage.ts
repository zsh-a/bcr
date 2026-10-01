import {
  contentHash,
  type RuntimeServices,
  type CachePrunePlan,
  type TaskJournalPrunePlan,
} from "@bcr/core";
import { OpfsStore, type BinaryStore } from "@bcr/storage-opfs";
import { Effect } from "effect";
import { readJson } from "./data";
import type { ResearchSession, DatasetRefs } from "./session";
import { datasetKey } from "./session";
import { parseManifest, type JsgResult, type ResearchDataset } from "./model";
import { withResearchFiles } from "./file-lease";
import { readSmallRecord, type PartitionRecord } from "./partition-cache";
import { marketPinnedIds } from "@bcr/market-data/research/catalog";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const isResearch = (id: string) => id.startsWith("jsg/") || id.startsWith("jsg-");
type StorageServices = {
  artifacts: RuntimeServices["artifacts"];
  scheduler: Pick<
    RuntimeServices["scheduler"],
    "planCachePrune" | "reclaimCache" | "planJournalPrune" | "reclaimJournal"
  >;
};
export interface SnapshotRecord {
  version: 1;
  dataset: ResearchDataset;
  createdAt?: string;
  sourceLastDate?: string;
  timings?: Record<string, number>;
}
export interface StoredSnapshot {
  path: string;
  record: SnapshotRecord;
  bytes: number;
  used: boolean;
}
export interface ResearchUsage {
  bytes: number;
  objects: number;
  snapshots: StoredSnapshot[];
}
export interface ResearchCleanupPlan {
  candidates: { id: string; storage: string; path: string; size: number }[];
  indexes: { path: string; bytes: Uint8Array }[];
  cache: CachePrunePlan;
  journal: TaskJournalPrunePlan;
  bytes: number;
}
export const researchStore = () => new OpfsStore("quant");
async function readRecord(store: BinaryStore, path: string): Promise<SnapshotRecord | undefined> {
  if (((await store.size(path)) ?? Infinity) > 4 * 1024 * 1024) return;
  try {
    const bytes = await store.get(path);
    if (!bytes) return;
    const record = JSON.parse(decoder.decode(bytes)) as SnapshotRecord;
    if (record.version !== 1 || !record.dataset || !Array.isArray(record.dataset.partitions))
      return;
    record.dataset.manifest = parseManifest(record.dataset.manifest);
    if (record.dataset.partitions.length !== record.dataset.manifest.partitions.length) return;
    return record;
  } catch {
    return;
  }
}
export async function rememberSnapshot(store: BinaryStore, dataset: ResearchDataset) {
  // Local imports gain a directory entry; ClickHouse records already carry provenance.
  const key = contentHash(encoder.encode(datasetKey(dataset)));
  const path = `cache/jsg-snapshots/${key}`;
  if (!(await store.has(path)))
    await store.put(
      path,
      encoder.encode(JSON.stringify({ version: 1, createdAt: new Date().toISOString(), dataset })),
    );
}
function datasets(state: ResearchSession): DatasetRefs[] {
  return [
    ...(state.dataset ? [state.dataset] : []),
    ...state.runs.map((r) => r.dataset),
    ...(state.selected ? [state.selected.dataset] : []),
    ...(state.grid ? [state.grid.dataset] : []),
    ...(state.study ? [state.study.dataset] : []),
  ];
}
export async function protectedResearchIds(
  services: StorageServices,
  state: ResearchSession,
  store: BinaryStore = researchStore(),
): Promise<Set<string>> {
  const roots = await marketPinnedIds(store);
  if (state.grid) roots.add(state.grid.run.resultRef.id);
  if (state.study) roots.add(state.study.run.resultRef.id);
  for (const d of datasets(state))
    for (const ref of [d.manifestRef, ...d.partitions]) roots.add(ref.id);
  const retained = new Map(state.runs.map((run) => [run.id, run]));
  if (state.selected) retained.set(state.selected.run.id, state.selected.run);
  for (const run of retained.values()) {
    roots.add(run.resultRef.id);
    if (run.benchmark) roots.add(run.benchmark.ref.id);
    // Fail closed when a retained run is corrupt: never infer that its chunks are disposable.
    const result = await readJson<JsgResult>(services, run.resultRef);
    for (const c of result.chunks ?? []) roots.add(c.ref.id);
  }
  return roots;
}
export async function researchUsage(
  services: StorageServices,
  state: ResearchSession,
  store: BinaryStore = researchStore(),
): Promise<ResearchUsage> {
  const entries = (
    await Effect.runPromise(services.artifacts.inventory({ storage: "opfs" }))
  ).filter((e) => isResearch(e.id));
  const used = new Set(datasets(state).map(datasetKey));
  const snapshots: StoredSnapshot[] = [];
  const known = new Set<string>();
  for (const path of [
    ...(await store.list("cache/jsg-clickhouse/")),
    ...(await store.list("cache/jsg-snapshots/")),
  ]) {
    const record = await readRecord(store, path);
    if (!record) continue;
    const identity = datasetKey(record.dataset);
    if (known.has(identity)) continue;
    known.add(identity);
    snapshots.push({
      path,
      record,
      used: used.has(identity),
      bytes: record.dataset.manifest.partitions.reduce((n, p) => n + p.bytes, 0),
    });
  }
  return { bytes: entries.reduce((n, e) => n + e.size, 0), objects: entries.length, snapshots };
}
export async function planResearchCleanup(
  services: StorageServices,
  state: ResearchSession,
  store: BinaryStore = researchStore(),
): Promise<ResearchCleanupPlan> {
  if (state.operation) throw new Error("请等待研究任务结束后清理");
  const roots = await protectedResearchIds(services, state, store);
  const cache = {
    ...(await Effect.runPromise(services.scheduler.planCachePrune({ maxEntries: 0 }))),
  };
  const keptTasks = new Set<string>();
  cache.candidates = cache.candidates.filter((c) => {
    const owned = c.outputs.length > 0 && c.outputs.every((o) => o.type.startsWith("quant/jsg-"));
    if (!owned || c.outputs.some((o) => roots.has(o.id))) {
      for (const id of c.taskIds) keptTasks.add(id);
      for (const o of c.outputs) roots.add(o.id);
      return false;
    }
    return true;
  });
  const journal = {
    ...(await Effect.runPromise(
      services.scheduler.planJournalPrune({
        maxEntries: 0,
        protectedTaskIds: [
          ...keptTasks,
          ...state.runs.map((r) => `jsg-${r.id}`),
          ...(state.grid ? [`jsg-grid-${state.grid.run.id}`] : []),
        ],
      }),
    )),
  };
  if (journal.activeEntries > 0) throw new Error("仍有计算任务运行，请结束后清理");
  journal.candidates = journal.candidates.filter((c) =>
    ["quant.backtest.jsg", "quant.grid.jsg"].includes(c.entry.task.operation),
  );
  const releasing = new Set(journal.candidates.map((c) => c.entry.task.id));
  for (const c of cache.candidates) for (const id of c.taskIds) releasing.add(id);
  const entries = await Effect.runPromise(services.artifacts.inventory({ storage: "opfs" }));
  const candidates: ResearchCleanupPlan["candidates"] = [];
  for (const entry of entries) {
    if (!isResearch(entry.id) || roots.has(entry.id)) continue;
    const consumers = await Effect.runPromise(services.artifacts.consumersOf(entry.id));
    if (consumers.some((id) => !releasing.has(id))) continue;
    candidates.push(entry);
  }
  const used = new Set(datasets(state).map(datasetKey));
  const indexes: ResearchCleanupPlan["indexes"] = [];
  for (const path of [
    ...(await store.list("cache/jsg-clickhouse/")),
    ...(await store.list("cache/jsg-snapshots/")),
  ]) {
    const record = await readRecord(store, path);
    if (record && used.has(datasetKey(record.dataset))) continue;
    if (((await store.size(path)) ?? Infinity) > 4 * 1024 * 1024) continue;
    const bytes = await store.get(path);
    if (bytes) indexes.push({ path, bytes });
  }
  return { candidates, indexes, cache, journal, bytes: candidates.reduce((n, e) => n + e.size, 0) };
}
export async function reclaimResearch(
  services: StorageServices,
  plan: ResearchCleanupPlan,
  current: () => ResearchSession,
  store: BinaryStore = researchStore(),
) {
  return withResearchFiles("exclusive", async () => {
    const fresh = await planResearchCleanup(services, current(), store);
    const approvedTasks = new Set(plan.journal.candidates.map((c) => c.entry.task.id));
    fresh.journal = {
      ...fresh.journal,
      candidates: fresh.journal.candidates.filter((c) => approvedTasks.has(c.entry.task.id)),
    };
    const approvedKeys = new Set(plan.cache.candidates.map((c) => c.key));
    fresh.cache = {
      ...fresh.cache,
      candidates: fresh.cache.candidates.filter((c) => approvedKeys.has(c.key)),
    };
    const cache = await Effect.runPromise(services.scheduler.reclaimCache(fresh.cache));
    const journal = await Effect.runPromise(services.scheduler.reclaimJournal(fresh.journal));
    const released = new Set(journal.removed.map((c) => c.entry.task.id));
    for (const c of cache.removed) for (const id of c.taskIds) released.add(id);
    for (const id of released) await Effect.runPromise(services.artifacts.releaseTask(id));
    const roots = await protectedResearchIds(services, current(), store);
    for (const skipped of cache.skipped)
      for (const ref of skipped.candidate.outputs) roots.add(ref.id);
    const actual = {
      ...(await Effect.runPromise(services.artifacts.planCleanup({ protectedIds: [...roots] }))),
    };
    const approved = new Map(plan.candidates.map((c) => [c.id, c.size]));
    const stillDisposable = new Set(fresh.candidates.map((entry) => entry.id));
    actual.candidates = actual.candidates.filter(
      (c) => approved.get(c.id) === c.size && stillDisposable.has(c.id),
    );
    const result = await Effect.runPromise(
      services.artifacts.reclaim(actual, { protectedIds: [...roots] }),
    );
    const used = new Set(datasets(current()).map(datasetKey));
    for (const index of plan.indexes) {
      const record = await readRecord(store, index.path);
      if (record && used.has(datasetKey(record.dataset))) continue;
      const bytes = await store.get(index.path);
      if (
        bytes &&
        bytes.length === index.bytes.length &&
        bytes.every((b, i) => b === index.bytes[i])
      )
        await store.delete(index.path);
    }
    for (const path of await store.list("cache/jsg-partitions/")) {
      const index = await readSmallRecord<PartitionRecord>(store, path);
      if (!index?.ref || !(await store.has(`artifacts/${index.ref.id}`))) await store.delete(path);
    }
    return result;
  });
}
/** Only call during project startup, before any file operation can start. */
export async function recoverResearchFiles(store: BinaryStore = researchStore()) {
  for (const path of await store.list("temp/jsg/")) await store.delete(path);
  for (const path of await store.list("cache/jsg-partitions/")) {
    const index = await readSmallRecord<PartitionRecord>(store, path);
    if (!index?.ref || !(await store.has(`artifacts/${index.ref.id}`))) await store.delete(path);
  }
  if (typeof navigator !== "undefined" && typeof navigator.storage?.getDirectory === "function")
    await recoverResearchExports();
  return store.list("temp/jsg/");
}

/** Export downloads already use a 60-second grace period before their backing file is removed. */
export async function recoverResearchExports(
  store: BinaryStore = new OpfsStore("jsg-exports"),
  now = Date.now(),
) {
  if (!store.getBlob) return;
  for (const path of await store.list()) {
    if (!/^result-[0-9a-f-]{36}\.json$/iu.test(path)) continue;
    const file = await store.getBlob(path);
    if (file instanceof File && now - file.lastModified >= 60_000) await store.delete(path);
  }
}
