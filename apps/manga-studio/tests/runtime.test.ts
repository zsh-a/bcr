import type { ArtifactRef, ArtifactStore } from "@bcr/core";
import { artifactStore, ArtifactStoreTag } from "@bcr/core";
import { decodeDocumentContentPackage, decodeDocumentTranslationPackage } from "@bcr/document-core";
import { MemoryStore } from "@bcr/storage-opfs";
import { Context, Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import {
  fileFromDocumentHandoff,
  persistMangaDocumentPackages,
  type MangaRuntime,
} from "../src/runtime";
import type { MangaPage } from "../src/model";

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

  it("persists deterministic canonical packages and mirrors them to the host", async () => {
    const localStore = new MemoryStore();
    const hostStore = new MemoryStore();
    const local = await makeArtifacts(localStore);
    const host = await makeArtifacts(hostStore);
    const sourceRef: ArtifactRef = {
      id: "source/page-bridge",
      type: "file/image",
      storage: "memory",
      format: "image/png",
      hash: "page-bridge-hash",
    };
    const page: MangaPage = {
      id: "page-bridge",
      createdAt: 42,
      source: {
        id: "page-bridge",
        kind: "image",
        name: "page-bridge.png",
        size: 3,
        objectUrl: "blob:page-bridge",
        ref: sourceRef,
        width: 100,
        height: 100,
        pageCount: 1,
      },
      stages: [],
      regions: [
        {
          id: "bubble-1",
          label: "BUBBLE 01",
          x: 10,
          y: 20,
          width: 30,
          height: 15,
          rotation: 0,
          writingMode: "vertical-rl",
          sourceText: "こんにちは",
          translatedText: "你好",
          confidence: 0.8,
          status: "reviewed",
        },
      ],
      activeRegionId: "bubble-1",
      outputMode: "translated",
      outputReady: true,
      dirty: false,
    };
    const runtime: MangaRuntime = { artifacts: local, binary: localStore, meta: undefined };

    const first = await persistMangaDocumentPackages(runtime, page, "ja", host);
    const second = await persistMangaDocumentPackages(runtime, page, "ja", host);
    expect(second).toEqual(first);
    expect(first.content.type).toBe("document/content-package");
    expect(first.translation.type).toBe("document/translation-package");
    expect(await Effect.runPromise(local.has(first.content))).toBe(true);
    expect(await Effect.runPromise(host.has(first.content))).toBe(true);

    const contentBytes = await Effect.runPromise(local.get(first.content));
    const translationBytes = await Effect.runPromise(local.get(first.translation));
    const content = decodeDocumentContentPackage(
      JSON.parse(new TextDecoder().decode(contentBytes)) as unknown,
    );
    const translation = decodeDocumentTranslationPackage(
      JSON.parse(new TextDecoder().decode(translationBytes)) as unknown,
    );
    expect(content).toMatchObject({ sourceRef, provenance: { createdAt: 42 } });
    expect(translation).toMatchObject({
      sourceContentId: content?.id,
      provenance: { createdAt: 42 },
    });
    expect(translation?.blocks[0]).toMatchObject({
      id: "bubble-1",
      translatedText: "你好",
      writingMode: "vertical-rl",
    });
  });
});
