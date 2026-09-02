import type { ArtifactRef, ArtifactStore } from "@bcr/core";
import { artifactStore, ArtifactStoreTag } from "@bcr/core";
import { createDocumentContentPackage, createDocumentTranslationPackage } from "@bcr/document-core";
import { MemoryStore } from "@bcr/storage-opfs";
import { Context, Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { importReaderDocumentHandoff, type ReaderRuntime } from "../src/runtime";

async function makeArtifacts(store: MemoryStore): Promise<ArtifactStore> {
  const context = await Effect.runPromise(
    Effect.scoped(Layer.build(artifactStore({ opfs: store, memory: new MemoryStore() }))),
  );
  return Context.get(context, ArtifactStoreTag);
}

const jsonRef = (id: string): ArtifactRef => ({
  id,
  type: "document/package",
  storage: "opfs",
  format: "json",
});

describe("reader durable Document handoff", () => {
  it("rebuilds the source File and reviewed sections from upstream Artifact refs", async () => {
    const upstreamStore = new MemoryStore();
    const targetStore = new MemoryStore();
    const upstream = await makeArtifacts(upstreamStore);
    const target = await makeArtifacts(targetStore);
    const sourceRef: ArtifactRef = {
      id: "document/source/reader-handoff",
      type: "file/txt",
      storage: "opfs",
      format: "text/plain",
      hash: "source-hash",
    };
    const content = createDocumentContentPackage({
      id: "content-reader-handoff",
      format: "txt",
      sourceName: "handoff.txt",
      adapter: "text.extract",
      blocks: [{ id: "body", label: "正文", text: "Source text" }],
    });
    const translation = createDocumentTranslationPackage({
      id: "translation-reader-handoff",
      sourceContentId: content.id,
      sourceName: content.sourceName,
      format: content.format,
      targetLanguage: "zh-Hans",
      adapter: "review.manual",
      blocks: content.blocks.map((block) => ({
        ...block,
        translatedText: "审校后的内容",
        status: "translated" as const,
      })),
    });
    const contentRef = jsonRef("document/content/reader-handoff");
    const translationRef = jsonRef("document/translation/reader-handoff");
    await Effect.runPromise(upstream.put(sourceRef, new TextEncoder().encode("Source text")));
    await Effect.runPromise(
      upstream.put(contentRef, new TextEncoder().encode(JSON.stringify(content))),
    );
    await Effect.runPromise(
      upstream.put(translationRef, new TextEncoder().encode(JSON.stringify(translation))),
    );

    const runtime: ReaderRuntime = {
      binary: targetStore,
      artifacts: target,
      meta: undefined,
      ftsReady: false,
      indexSession: undefined,
      parseSession: undefined,
      parserMode: "main",
    };
    const book = await importReaderDocumentHandoff(
      runtime,
      {
        id: "handoff-reader-test",
        jobId: "job-reader-test",
        target: "reader",
        name: "handoff.txt",
        format: "txt",
        size: 11,
        sourceRef,
        contentRef,
        translationRef,
        createdAt: 1,
      },
      upstream,
    );

    expect(book.source.name).toBe("handoff.txt");
    expect(book.sections[0]).toMatchObject({
      id: "body",
      text: "审校后的内容",
    });
    expect(book.source.ref?.id).toMatch(/^reader\//u);
    const stored = await Effect.runPromise(target.inventory({ idPrefix: "reader/" }));
    expect(stored.map((entry) => entry.id)).toContain(book.source.ref?.id);
  });
});
