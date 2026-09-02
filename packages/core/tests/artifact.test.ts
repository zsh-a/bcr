import { MemoryStore } from "@bcr/storage-opfs";
import { Context, Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { artifactPath, artifactStore, ArtifactStoreTag, type ArtifactStore } from "../src/artifact";
import type { ArtifactRef } from "../src/schema";
import type { ComputeTask } from "../src/schema";

const ref = (id: string, storage: ArtifactRef["storage"] = "memory"): ArtifactRef => ({
  id,
  type: "test/data",
  storage,
});

async function makeArtifacts(
  stores: Readonly<Record<string, MemoryStore>>,
): Promise<ArtifactStore> {
  const context = await Effect.runPromise(Effect.scoped(Layer.build(artifactStore(stores))));
  return Context.get(context, ArtifactStoreTag);
}

describe("ArtifactStore inventory / usage", () => {
  it("列出跨后端 Artifact，按 storage 与 id 稳定排序并保留字节数", async () => {
    const memory = new MemoryStore();
    const opfs = new MemoryStore();
    await memory.put(artifactPath(ref("zeta")), new Uint8Array([1, 2]));
    await memory.put(artifactPath(ref("reader/book")), new Uint8Array([3]));
    await opfs.put(artifactPath(ref("alpha", "opfs")), new Uint8Array([4, 5, 6]));
    await opfs.put("cache/not-an-artifact", new Uint8Array([7]));

    const artifacts = await makeArtifacts({ memory, opfs });
    expect(await Effect.runPromise(artifacts.inventory())).toEqual([
      { id: "reader/book", storage: "memory", path: "artifacts/reader/book", size: 1 },
      { id: "zeta", storage: "memory", path: "artifacts/zeta", size: 2 },
      { id: "alpha", storage: "opfs", path: "artifacts/alpha", size: 3 },
    ]);
  });

  it("支持后端与 id 前缀过滤，并为零容量后端返回空行", async () => {
    const memory = new MemoryStore();
    const opfs = new MemoryStore();
    await opfs.put(artifactPath(ref("reader/search-index/a", "opfs")), new Uint8Array([1, 2]));
    const artifacts = await makeArtifacts({ memory, opfs });

    expect(
      await Effect.runPromise(
        artifacts.inventory({ storage: "opfs", idPrefix: "reader/search-index/" }),
      ),
    ).toEqual([
      {
        id: "reader/search-index/a",
        storage: "opfs",
        path: "artifacts/reader/search-index/a",
        size: 2,
      },
    ]);
    expect(await Effect.runPromise(artifacts.inventory({ storage: "memory" }))).toEqual([]);
  });

  it("usage 聚合总量与各 BinaryStore，并忽略已经消失的对象", async () => {
    const memory = new MemoryStore();
    const opfs = new MemoryStore();
    await memory.put(artifactPath(ref("one")), new Uint8Array([1, 2, 3]));
    await opfs.put(artifactPath(ref("two", "opfs")), new Uint8Array([4]));
    const artifacts = await makeArtifacts({ memory, opfs });

    expect(await Effect.runPromise(artifacts.usage())).toEqual({
      totalObjects: 2,
      totalBytes: 4,
      byStorage: [
        { storage: "memory", objects: 1, bytes: 3 },
        { storage: "opfs", objects: 1, bytes: 1 },
      ],
    });
  });

  it("订阅物理对象变化，并在取消订阅后停止通知", async () => {
    const memory = new MemoryStore();
    const artifacts = await makeArtifacts({ memory });
    let changes = 0;
    const unsubscribe = artifacts.subscribe(() => {
      changes += 1;
    });
    const item = ref("events/item");
    await Effect.runPromise(artifacts.put(item, new Uint8Array([1])));
    await Effect.runPromise(artifacts.delete(item));
    expect(changes).toBe(2);
    unsubscribe();
    await Effect.runPromise(artifacts.put(item, new Uint8Array([2])));
    expect(changes).toBe(2);
  });

  it("cleanup plan 保护根与血缘对象，只标记未追踪产物；reclaim 二次校验后删除", async () => {
    const memory = new MemoryStore();
    const artifacts = await makeArtifacts({ memory });
    const source = ref("source/book");
    const derived = ref("derived/result");
    const orphan = ref("tmp/failed-output");
    await memory.put(artifactPath(source), new Uint8Array([1]));
    await memory.put(artifactPath(derived), new Uint8Array([2, 3]));
    await memory.put(artifactPath(orphan), new Uint8Array([4, 5, 6]));
    await Effect.runPromise(artifacts.registerProduction("task-derived", [derived]));
    const consumer: ComputeTask = {
      id: "task-consumer",
      runtime: "js",
      operation: "test.consume",
      inputs: [derived],
      outputs: [],
    };
    await Effect.runPromise(artifacts.registerConsumption(consumer));

    const plan = await Effect.runPromise(artifacts.planCleanup({ protectedIds: [source.id] }));
    expect(plan.scannedObjects).toBe(3);
    expect(plan.candidates).toEqual([
      {
        id: orphan.id,
        storage: "memory",
        path: artifactPath(orphan),
        size: 3,
        reason: "untracked",
      },
    ]);

    const result = await Effect.runPromise(artifacts.reclaim(plan));
    expect(result).toMatchObject({ requested: 1, reclaimedBytes: 3, skipped: [] });
    expect(result.deleted.map(({ id }) => id)).toEqual([orphan.id]);
    expect(await Effect.runPromise(artifacts.has(source))).toBe(true);
    expect(await Effect.runPromise(artifacts.has(derived))).toBe(true);
    expect(await Effect.runPromise(artifacts.has(orphan))).toBe(false);
  });

  it("reclaim 发现计划过期或新保护根时跳过，不删除变化对象", async () => {
    const memory = new MemoryStore();
    const artifacts = await makeArtifacts({ memory });
    const orphan = ref("tmp/race");
    await memory.put(artifactPath(orphan), new Uint8Array([1]));
    const plan = await Effect.runPromise(artifacts.planCleanup());

    await memory.put(artifactPath(orphan), new Uint8Array([1, 2]));
    const changed = await Effect.runPromise(artifacts.reclaim(plan));
    expect(changed.deleted).toEqual([]);
    expect(changed.skipped[0]).toMatchObject({ reason: "changed" });
    expect(await Effect.runPromise(artifacts.has(orphan))).toBe(true);

    const protectedPlan = await Effect.runPromise(artifacts.planCleanup());
    const protectedResult = await Effect.runPromise(
      artifacts.reclaim(protectedPlan, { protectedIds: [orphan.id] }),
    );
    expect(protectedResult.deleted).toEqual([]);
    expect(protectedResult.skipped[0]).toMatchObject({ reason: "protected" });
    expect(await Effect.runPromise(artifacts.has(orphan))).toBe(true);
  });
});
