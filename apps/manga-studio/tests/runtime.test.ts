import type { ArtifactRef, ArtifactStore } from "@bcr/core";
import { artifactStore, ArtifactStoreTag } from "@bcr/core";
import { MemoryStore } from "@bcr/storage-opfs";
import { Context, Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { fileFromDocumentHandoff, type MangaRuntime } from "../src/runtime";

async function makeArtifacts(store: MemoryStore): Promise<ArtifactStore> {
  const context = await Effect.runPromise(
    Effect.scoped(Layer.build(artifactStore({ opfs: store, memory: new MemoryStore() }))),
  );
  return Context.get(context, ArtifactStoreTag);
}

describe("manga durable Document handoff", () => {
  it("rebuilds an image File from the host ArtifactStore", async () => {
    const upstreamStore = new MemoryStore();
    const upstream = await makeArtifacts(upstreamStore);
    const sourceRef: ArtifactRef = {
      id: "document/source/manga-handoff",
      type: "file/image",
      storage: "opfs",
      format: "image/png",
      hash: "image-hash",
    };
    await Effect.runPromise(upstream.put(sourceRef, new Uint8Array([137, 80, 78, 71, 1, 2, 3])));

    const runtime: MangaRuntime = {
      artifacts: upstream,
      binary: upstreamStore,
      meta: undefined,
    };
    const file = await fileFromDocumentHandoff(runtime, {
      id: "handoff-manga-test",
      jobId: "job-manga-test",
      target: "manga",
      name: "page.png",
      format: "image",
      size: 7,
      sourceRef,
      createdAt: 1,
    });

    expect(file.name).toBe("page.png");
    expect(file.type).toBe("image/png");
    expect(file.size).toBe(7);
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(
      new Uint8Array([137, 80, 78, 71, 1, 2, 3]),
    );
  });
});
