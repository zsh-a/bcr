import type { ArtifactRef, ArtifactStore } from "@bcr/core";
import { artifactStore, ArtifactStoreTag } from "@bcr/core";
import {
  createDocumentContentPackage,
  createDocumentTranslationPackage,
  serializeDocumentExport,
} from "@bcr/document-core";
import { MemoryStore } from "@bcr/storage-opfs";
import { Context, Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import {
  importReaderDocumentHandoff,
  importReaderExportBundle,
  prepareReaderDocumentHandoff,
  restoreReader,
  type ReaderRuntime,
} from "../src/runtime";
import { createDemoBook } from "../src/model";

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
  it("reports skipped binary books when a source Artifact is missing", async () => {
    const store = new MemoryStore();
    const artifacts = await makeArtifacts(store);
    const missingSource: ArtifactRef = {
      id: "reader/missing-source",
      type: "file/publication",
      storage: "opfs",
      format: "application/epub+zip",
      hash: "missing-source-hash",
    };
    const library = {
      version: 1,
      books: [
        {
          id: "book-missing",
          title: "Missing EPUB",
          source: {
            name: "missing.epub",
            format: "epub",
            mime: "application/epub+zip",
            size: 42,
            ref: missingSource,
          },
          sections: [],
          importedAt: 1,
          updatedAt: 1,
          tags: [],
        },
        {
          id: "book-text",
          title: "Recovered notes",
          source: {
            name: "notes.md",
            format: "markdown",
            mime: "text/markdown",
            size: 12,
          },
          sections: [
            {
              id: "body",
              order: 0,
              label: "正文",
              kind: "text",
              text: "Recovered body",
            },
          ],
          importedAt: 1,
          updatedAt: 1,
          tags: [],
        },
      ],
    };
    const metadata = new Map<string, string>([
      ["reader/library", JSON.stringify(library)],
      ["reader/session", JSON.stringify({ version: 1, activeBookId: "book-text" })],
    ]);
    const runtime: ReaderRuntime = {
      binary: store,
      artifacts,
      meta: {
        kvGet: (key: string) => metadata.get(key),
      } as never,
      ftsReady: false,
      indexSession: undefined,
      parseSession: undefined,
      parserMode: "main",
    };

    const restored = await restoreReader(runtime);

    expect(restored?.books.map((book) => book.id)).toEqual(["book-text"]);
    expect(restored?.recovery).toMatchObject({
      attemptedBooks: 2,
      restoredBooks: 1,
      usedLegacyLibrary: false,
    });
    expect(restored?.recovery.skippedBooks[0]).toMatchObject({
      bookId: "book-missing",
      name: "missing.epub",
    });
  });

  it("mirrors the source and canonical projection into the host namespace", async () => {
    const localStore = new MemoryStore();
    const hostStore = new MemoryStore();
    const local = await makeArtifacts(localStore);
    const host = await makeArtifacts(hostStore);
    const sourceRef: ArtifactRef = {
      id: "reader/demo-source",
      type: "file/publication",
      storage: "opfs",
      format: "text/markdown",
      hash: "demo-source-hash",
    };
    await Effect.runPromise(local.put(sourceRef, new TextEncoder().encode("# demo")));
    const demo = createDemoBook();
    const book = {
      ...demo,
      source: {
        ...demo.source,
        ref: {
          id: sourceRef.id,
          hash: sourceRef.hash!,
          storage: "opfs" as const,
          mime: "text/markdown",
          size: 6,
        },
      },
    };
    const runtime: ReaderRuntime = {
      binary: localStore,
      artifacts: local,
      meta: undefined,
      ftsReady: false,
      indexSession: undefined,
      parseSession: undefined,
      parserMode: "main",
    };

    const payload = await prepareReaderDocumentHandoff(runtime, host, book);

    expect(payload.file.name).toBe(book.source.name);
    expect(payload.sourceRef).toMatchObject({
      id: "document/source/demo-source-hash",
      hash: "demo-source-hash",
    });
    expect(payload.content.provenance.adapter).toBe("reader.projection");
    expect(payload.contentRef.id).toMatch(/^document\/content\/reader\//u);
    await expect(Effect.runPromise(host.has(payload.sourceRef))).resolves.toBe(true);
    await expect(Effect.runPromise(host.has(payload.contentRef))).resolves.toBe(true);
  });

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

  it("replays a validated text Export Bundle without invoking a parser", async () => {
    const store = new MemoryStore();
    const artifacts = await makeArtifacts(store);
    const runtime: ReaderRuntime = {
      binary: store,
      artifacts,
      meta: undefined,
      ftsReady: false,
      indexSession: undefined,
      parseSession: undefined,
      parserMode: "main",
    };
    const content = createDocumentContentPackage({
      id: "reader-export-content",
      format: "markdown",
      sourceName: "exported-notes.md",
      metadata: { title: "Exported notes" },
      adapter: "markdown.extract",
      blocks: [{ id: "body", label: "正文", text: "Source body" }],
    });
    const translation = createDocumentTranslationPackage({
      id: "reader-export-translation",
      sourceContentId: content.id,
      sourceName: content.sourceName,
      format: content.format,
      targetLanguage: "zh-Hans",
      adapter: "review.manual",
      blocks: [{ id: "body", label: "正文", text: "Source body", translatedText: "译文" }],
    });
    const payload = serializeDocumentExport(content, translation, "json");
    const file = new File([payload.text], "exported-notes.json", { type: payload.mime });

    const book = await importReaderExportBundle(runtime, file);

    expect(book.title).toBe("Exported notes");
    expect(book.source.format).toBe("markdown");
    expect(book.sections).toEqual([
      expect.objectContaining({ id: "body", text: "译文", label: "正文" }),
    ]);
    expect(book.source.ref?.id).toMatch(/^reader\//u);
  });

  it("rejects visual Export Bundles at the Reader boundary", async () => {
    const store = new MemoryStore();
    const artifacts = await makeArtifacts(store);
    const runtime: ReaderRuntime = {
      binary: store,
      artifacts,
      meta: undefined,
      ftsReady: false,
      indexSession: undefined,
      parseSession: undefined,
      parserMode: "main",
    };
    const content = createDocumentContentPackage({
      id: "reader-image-export",
      format: "image",
      sourceName: "page.png",
      adapter: "manga.review.regions",
      blocks: [{ id: "region-1", label: "Region", text: "文字" }],
    });
    const payload = serializeDocumentExport(content, undefined, "json");
    const file = new File([payload.text], "page.json", { type: payload.mime });

    await expect(importReaderExportBundle(runtime, file)).rejects.toThrow("Manga Studio");
  });
});
