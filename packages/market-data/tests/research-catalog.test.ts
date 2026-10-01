import { describe, expect, it } from "vitest";
import { MemoryStore } from "@bcr/storage-opfs";
import { artifactPath, contentHash, type ArtifactRef } from "@bcr/core";
import { demoResearch } from "../../../apps/quant-lab/src/jsg/demo";
import {
  listMarketSnapshots,
  pinMarketSnapshot,
  readMarketSnapshot,
  marketPinnedIds,
  unpinMarketSnapshot,
  saveMarketLabels,
  readMarketLabels,
} from "../src/research/catalog";
import type { ResearchDataset } from "../src/research/model";

async function fixture() {
  const demo = demoResearch(),
    store = new MemoryStore();
  const put = async (id: string, bytes: Uint8Array, type: string, format: "json" | "arrow") => {
    const ref: ArtifactRef = { id, hash: contentHash(bytes), storage: "opfs", type, format };
    await store.put(artifactPath(ref), bytes);
    return ref;
  };
  const partitions = [];
  for (const file of demo.files.slice(1))
    partitions.push(
      await put(
        `jsg/daily/${file.name}`,
        new Uint8Array(await file.arrayBuffer()),
        "quant/jsg-daily",
        "arrow",
      ),
    );
  const manifestRef = await put(
    "jsg/manifest/demo",
    new TextEncoder().encode(JSON.stringify(demo.manifest)),
    "quant/jsg-manifest",
    "json",
  );
  const dataset: ResearchDataset = { manifest: demo.manifest, manifestRef, partitions };
  return { store, dataset };
}
describe("shared frozen snapshot catalog", () => {
  it("shares enriched Chinese labels without changing immutable data or snapshot identity", async () => {
    const { store, dataset } = await fixture();
    const id = await pinMarketSnapshot(dataset, store),
      original = structuredClone(dataset);
    await saveMarketLabels(
      dataset,
      { instruments: {}, industries: { technology: "中文行业名称" } },
      store,
    );
    expect((await readMarketLabels(dataset, store)).industries.technology).toBe("中文行业名称");
    expect(await pinMarketSnapshot(dataset, store)).toBe(id);
    expect(await readMarketSnapshot(id, store)).toEqual(original);
  });
  it("resolves a small cross-app reference, deduplicates it, protects artifacts and allows explicit release", async () => {
    const { store, dataset } = await fixture();
    const id = await pinMarketSnapshot(dataset, store);
    expect(await readMarketSnapshot(id, store)).toEqual(dataset);
    expect(await pinMarketSnapshot(dataset, store)).toBe(id);
    expect(await listMarketSnapshots(store)).toHaveLength(1);
    expect(await marketPinnedIds(store)).toEqual(
      new Set([dataset.manifestRef.id, ...dataset.partitions.map((r) => r.id)]),
    );
    await unpinMarketSnapshot(id, store);
    expect(await marketPinnedIds(store)).toEqual(new Set());
    expect(await store.has(artifactPath(dataset.partitions[0]!))).toBe(true);
  });
  it("rejects missing partitions without publishing a broken retention root", async () => {
    const { store, dataset } = await fixture();
    await store.delete(artifactPath(dataset.partitions[0]!));
    await expect(pinMarketSnapshot(dataset, store)).rejects.toThrow("移除");
    expect(await store.list("cache/market-pins/")).toHaveLength(0);
    expect(await listMarketSnapshots(store)).toHaveLength(0);
  });
  it("ignores malformed cache indexes but fails closed for a corrupted retained reference", async () => {
    const { store, dataset } = await fixture();
    await store.put("cache/jsg-clickhouse/broken", new TextEncoder().encode("{}"));
    const id = await pinMarketSnapshot(dataset, store);
    expect(await listMarketSnapshots(store)).toHaveLength(1);
    await store.delete(artifactPath(dataset.partitions[0]!));
    await expect(readMarketSnapshot(id, store)).rejects.toThrow("不可用");
    await expect(marketPinnedIds(store)).rejects.toThrow("损坏");
  });
});
