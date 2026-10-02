import { artifactPath, contentHash } from "@bcr/core";
import type { BinaryStore } from "@bcr/storage-opfs";
import { marketResearchStore } from "./storage";
export { marketResearchStore } from "./storage";
import { parseManifest, MAX_MANIFEST_BYTES, type ResearchDataset } from "./model";
import {
  publicProfile,
  type ClickHouseConnection,
  type ClickHouseRange,
  type ClickHouseProfile,
} from "./clickhouse-http";
import { parseDisplayNames, subsetNames, type DisplayNames } from "./display-names";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
export function snapshotId(dataset: ResearchDataset) {
  return contentHash(
    encoder.encode(
      JSON.stringify([dataset.manifestRef.hash, ...dataset.partitions.map((r) => r.hash)]),
    ),
  );
}
/** Display metadata may be enriched without changing frozen Arrow or manifest hashes. */
export async function saveMarketLabels(
  dataset: ResearchDataset,
  names: DisplayNames,
  store: BinaryStore = marketResearchStore(),
) {
  const labels = subsetNames(
    names,
    dataset.manifest.instruments.map((i) => i.code),
    dataset.manifest.industries,
  );
  const bytes = encoder.encode(JSON.stringify(labels));
  if (bytes.length > MAX_MANIFEST_BYTES) throw new Error("名称字典超过大小限制");
  await store.put(`cache/market-labels/${snapshotId(dataset)}`, bytes);
}
export async function readMarketLabels(
  dataset: ResearchDataset,
  store: BinaryStore = marketResearchStore(),
): Promise<DisplayNames> {
  const base = dataset.manifest.displayNames ?? { instruments: {}, industries: {} };
  try {
    const path = `cache/market-labels/${snapshotId(dataset)}`;
    if (((await store.size(path)) ?? Infinity) > MAX_MANIFEST_BYTES) return base;
    const bytes = await store.get(path);
    if (!bytes) return base;
    const cached = subsetNames(
      parseDisplayNames(JSON.parse(decoder.decode(bytes))),
      dataset.manifest.instruments.map((i) => i.code),
      dataset.manifest.industries,
    );
    return {
      ...cached,
      instruments: { ...base.instruments, ...cached.instruments },
      industries: { ...base.industries, ...cached.industries },
    };
  } catch {
    return base;
  }
}
async function readDatasetRecord(
  store: BinaryStore,
  path: string,
): Promise<ResearchDataset | undefined> {
  if (((await store.size(path)) ?? Infinity) > MAX_MANIFEST_BYTES) return;
  const bytes = await store.get(path);
  if (!bytes) return;
  const value = JSON.parse(decoder.decode(bytes)) as { version: number; dataset: ResearchDataset };
  if (value.version !== 1 || !value.dataset) return;
  const dataset = value.dataset;
  dataset.manifest = parseManifest(dataset.manifest);
  if (
    !Array.isArray(dataset.partitions) ||
    dataset.partitions.length !== dataset.manifest.partitions.length
  )
    return;
  if (
    !dataset.manifestRef ||
    dataset.manifestRef.storage !== "opfs" ||
    !dataset.manifestRef.id.startsWith("jsg/")
  )
    return;
  if (!(await store.has(artifactPath(dataset.manifestRef)))) return;
  for (let i = 0; i < dataset.partitions.length; i++) {
    const ref = dataset.partitions[i]!;
    if (
      ref.storage !== "opfs" ||
      !ref.id.startsWith("jsg/") ||
      (await store.size(artifactPath(ref))) !== dataset.manifest.partitions[i]!.bytes
    )
      return;
  }
  return dataset;
}
export async function listMarketSnapshots(store: BinaryStore = marketResearchStore()) {
  const known = new Map<string, ResearchDataset>();
  for (const prefix of ["cache/jsg-clickhouse/", "cache/jsg-snapshots/", "cache/market-pins/"]) {
    for (const path of await store.list(prefix)) {
      try {
        const d = await readDatasetRecord(store, path);
        if (d) known.set(snapshotId(d), d);
      } catch {
        /* Ignore incomplete directory records. */
      }
    }
  }
  return [...known.values()].sort((a, b) =>
    (b.snapshot?.createdAt ?? "").localeCompare(a.snapshot?.createdAt ?? ""),
  );
}
/** A cross-app link pins immutable artifacts, rather than carrying their data through the URL. */
export async function pinMarketSnapshot(
  dataset: ResearchDataset,
  store: BinaryStore = marketResearchStore(),
) {
  const id = snapshotId(dataset);
  const bytes = encoder.encode(JSON.stringify({ version: 1, dataset }));
  if (bytes.byteLength > MAX_MANIFEST_BYTES) throw new Error("快照目录超过大小限制");
  const path = `cache/market-pins/${id}`;
  // Validate before publication so a failed handoff cannot create a corrupt retained root.
  for (const ref of [dataset.manifestRef, ...dataset.partitions]) {
    if (!(await store.has(artifactPath(ref)))) throw new Error("快照数据已被移除");
  }
  await store.put(path, bytes);
  if (!(await readDatasetRecord(store, path))) {
    await store.delete(path);
    throw new Error("快照数据已被移除");
  }
  return id;
}
export async function unpinMarketSnapshot(id: string, store: BinaryStore = marketResearchStore()) {
  if (!/^[a-f0-9]{64}$/u.test(id)) throw new Error("快照引用无效");
  await store.delete(`cache/market-pins/${id}`);
}
export async function readMarketSnapshot(id: string, store: BinaryStore = marketResearchStore()) {
  if (!/^[a-f0-9]{64}$/u.test(id)) throw new Error("快照引用无效");
  const dataset = await readDatasetRecord(store, `cache/market-pins/${id}`);
  if (!dataset || snapshotId(dataset) !== id)
    throw new Error("快照不可用，请在 Market 重新选择数据");
  return dataset;
}
export async function marketPinnedIds(store: BinaryStore = marketResearchStore()) {
  const roots = new Set<string>();
  for (const path of await store.list("cache/market-pins/")) {
    const d = await readDatasetRecord(store, path);
    if (!d) throw new Error("共享快照引用损坏，请先恢复或移除共享引用");
    for (const r of [d.manifestRef, ...d.partitions]) roots.add(r.id);
  }
  return roots;
}
const PROFILE = "bcr.market.clickhouse-profile.v1";
export function readMarketProfile(): ClickHouseProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE);
    if (!raw) return null;
    const p = JSON.parse(raw) as ClickHouseProfile;
    return publicProfile({ ...p, password: "" }, { ...p, refresh: false });
  } catch {
    return null;
  }
}
export function saveMarketProfile(connection: ClickHouseConnection, range: ClickHouseRange) {
  localStorage.setItem(PROFILE, JSON.stringify(publicProfile(connection, range)));
}
