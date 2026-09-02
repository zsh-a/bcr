import { MemoryStore } from "@bcr/storage-opfs";
import { Context, Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { artifactPath, artifactStore, ArtifactStoreTag, type ArtifactStore } from "../src/artifact";
import type { ArtifactRef } from "../src/schema";

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
});
