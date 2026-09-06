import { loadTxtSection } from "../src/lazyTxt";
import { artifactStore, ArtifactStoreTag, type ArtifactRef, type ArtifactStore } from "@bcr/core";
import { progressForLocator } from "@bcr/reader-core";
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
  importReaderFile,
  importReaderExportBundle,
  prepareReaderDocumentHandoff,
  persistReader,
  restoreReader,
  restoreReaderBooks,
  type ReaderRuntime,
} from "../src/runtime";
import { createDemoBook, DEFAULT_READER_SETTINGS, type ReaderState } from "../src/model";

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

function readyReaderState(
  library: ReaderState["library"],
  activeBookId = library[0]?.id ?? null,
): ReaderState {
  const active = library.find((book) => book.id === activeBookId) ?? library[0];
  const progress =
    active === undefined
      ? {}
      : {
          [active.id]: progressForLocator(active, {
            kind: "section",
            sectionId: active.sections[0]?.id ?? "body",
            progression: 0,
          }),
        };
  return {
    status: "ready",
    error: null,
    library,
    activeBookId,
    activeSectionId: active?.sections[0]?.id ?? null,
    navigationSequence: 0,
    navigationHistory: { back: [], forward: [] },
    searchScope: "library",
    progressByBook: progress,
    bookmarksByBook: {},
    annotationsByBook: {},
    query: "",
    searchHits: [],
    searchBookId: null,
    searchActiveIndex: -1,
    searchBusy: false,
    searchReveal: null,
    settings: DEFAULT_READER_SETTINGS,
    sidebarOpen: false,
    searchOpen: false,
    lastSavedAt: null,
    saveError: null,
  };
}

async function withLocalStorage<T>(run: (values: Map<string, string>) => Promise<T>): Promise<T> {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, String(value)),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  } as Storage;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  try {
    return await run(values);
  } finally {
    if (previous === undefined) {
      Reflect.deleteProperty(globalThis, "localStorage");
    } else {
      Object.defineProperty(globalThis, "localStorage", previous);
    }
  }
}

describe("reader durable Document handoff", () => {
  it("restores TXT indexes without loading bodies and rebuilds an invalid index from its source", async () => {
    await withLocalStorage(async (values) => {
      const store = new MemoryStore();
      const runtime: ReaderRuntime = {
        binary: store,
        artifacts: await makeArtifacts(store),
        meta: undefined,
        ftsReady: false,
        indexSession: undefined,
        parseSession: undefined,
        parserMode: "main",
      };
      const text = Array.from(
        { length: 1000 },
        (_, index) => `${index} ${"索引恢复正文".repeat(20)}`,
      ).join("\n\n");
      const book = await importReaderFile(
        runtime,
        new File([text], "index.txt", { type: "text/plain" }),
      );
      await persistReader(runtime, readyReaderState([book]));
      const restored = (await restoreReader(runtime, { deferBinary: true }))!.books[0]!;
      expect(restored.sections.every((section) => section.text === "")).toBe(true);
      expect(restored.sections.map((section) => section.textRange)).toEqual(
        book.sections.map((section) => section.textRange),
      );
      await loadTxtSection(restored.sections[999]!);
      expect(restored.sections[999]!.text).toBe(text.split("\n\n")[999]);
      const raw = JSON.parse(values.get("bcr.reader.library.v1")!);
      raw.books[0].sections[0].textRange.end = text.length * 100;
      values.set("bcr.reader.library.v1", JSON.stringify(raw));
      const rebuilt = (await restoreReader(runtime))!.books[0]!;
      expect(rebuilt.sections.map((section) => section.textRange)).toEqual(
        book.sections.map((section) => section.textRange),
      );
    });
  });

  it("does not read paragraph content again for a session-only save", async () => {
    await withLocalStorage(async () => {
      const store = new MemoryStore();
      const runtime: ReaderRuntime = {
        binary: store,
        artifacts: await makeArtifacts(store),
        meta: undefined,
        ftsReady: false,
        indexSession: undefined,
        parseSession: undefined,
        parserMode: "main",
      };
      let reads = 0;
      const demo = createDemoBook();
      const book = {
        ...demo,
        sections: demo.sections.map((section) => ({
          ...section,
          get text() {
            reads++;
            return section.text;
          },
        })),
      };
      const state = readyReaderState([book]);
      await persistReader(runtime, state);
      reads = 0;
      await persistReader(runtime, { ...state, settings: { ...state.settings, fontSize: 24 } });
      expect(reads).toBe(0);
      await persistReader(runtime, state, { forceLibrary: true });
      expect(reads).toBeGreaterThan(0);
    });
  });

  it("restores in requested priority order and publishes each book before the batch completes", async () => {
    await withLocalStorage(async () => {
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
      const first = {
        ...createDemoBook(),
        id: "first",
        sections: createDemoBook().sections.map((section) => ({
          ...section,
          pageAspectRatio: 0.75,
        })),
      };
      const active = { ...createDemoBook(), id: "active" };
      await persistReader(runtime, readyReaderState([first, active], active.id));
      const published: string[] = [];
      let complete = false;
      const result = await restoreReaderBooks(
        runtime,
        [active.id, first.id, active.id],
        undefined,
        (book) => {
          expect(complete).toBe(false);
          published.push(book.id);
        },
      );
      complete = true;
      expect(published).toEqual(["active", "first"]);
      expect(result.books.map((book) => book.id)).toEqual(published);
      expect(result.books[1]?.sections[0]?.pageAspectRatio).toBe(0.75);
    });
  });
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

  it("mirrors a changed library before waiting for SQLite", async () => {
    await withLocalStorage(async (values) => {
      const store = new MemoryStore();
      const artifacts = await makeArtifacts(store);
      let releaseMetadataWrite: (() => void) | undefined;
      const metadataWrite = new Promise<void>((resolve) => {
        releaseMetadataWrite = resolve;
      });
      const runtime: ReaderRuntime = {
        binary: store,
        artifacts,
        meta: {
          kvSet: async () => metadataWrite,
        } as never,
        ftsReady: false,
        indexSession: undefined,
        parseSession: undefined,
        parserMode: "main",
      };
      const book = createDemoBook();
      const pending = persistReader(runtime, readyReaderState([book]));

      try {
        expect(values.get("bcr.reader.library.v1")).toContain(book.id);
        expect(values.get("bcr.reader.session.v1")).toContain("librarySignature");
      } finally {
        releaseMetadataWrite?.();
      }
      await pending;
    });
  });

  it("detects a stale local library and recovers the canonical SQLite copy", async () => {
    await withLocalStorage(async (values) => {
      const store = new MemoryStore();
      const artifacts = await makeArtifacts(store);
      const metadata = new Map<string, string>();
      const runtime: ReaderRuntime = {
        binary: store,
        artifacts,
        meta: {
          kvGet: async (key: string) => metadata.get(key),
          kvSet: async (key: string, value: string) => {
            metadata.set(key, value);
          },
        } as never,
        ftsReady: false,
        indexSession: undefined,
        parseSession: undefined,
        parserMode: "main",
      };
      const demo = createDemoBook();
      const imported = {
        ...createDemoBook(),
        id: "book-newly-imported",
        rendition: { layout: "reflowable", direction: "ltr", spread: "auto" } as const,
        title: "重启后仍在的图书",
        source: {
          ...createDemoBook().source,
          name: "durable-book.md",
        },
        importedAt: demo.importedAt + 1,
        updatedAt: demo.updatedAt + 1,
      };
      await persistReader(runtime, readyReaderState([demo, imported], imported.id));

      const canonical = JSON.parse(values.get("bcr.reader.library.v1") ?? "{}") as {
        version: 1;
        books: ReadonlyArray<unknown>;
      };
      values.set(
        "bcr.reader.library.v1",
        JSON.stringify({ version: 1, books: canonical.books.slice(0, 1) }),
      );
      const restarted: ReaderRuntime = { ...runtime, meta: undefined };

      const fast = await restoreReader(restarted, { deferBinary: true });
      expect(fast?.books.map((book) => book.id)).toEqual([demo.id]);
      expect(fast?.activeBookId).toBe(imported.id);
      expect(fast?.libraryOutdated).toBe(true);

      restarted.meta = runtime.meta;
      const durable = await restoreReader(restarted, { deferBinary: true });
      expect(durable?.books.map((book) => book.id)).toEqual([demo.id, imported.id]);
      expect(durable?.activeBookId).toBe(imported.id);
      expect(durable?.libraryOutdated).toBe(false);
      expect(durable?.books.find((book) => book.id === imported.id)?.rendition).toEqual(
        imported.rendition,
      );
    });
  });

  it("mirrors the reading session so a memory-backed metadata store survives reload", async () => {
    await withLocalStorage(async (values) => {
      const store = new MemoryStore();
      const artifacts = await makeArtifacts(store);
      const metadata = new Map<string, string>();
      const runtime: ReaderRuntime = {
        binary: store,
        artifacts,
        meta: {
          kvGet: async (key: string) => metadata.get(key),
          kvSet: async (key: string, value: string) => {
            metadata.set(key, value);
          },
        } as never,
        ftsReady: false,
        indexSession: undefined,
        parseSession: undefined,
        parserMode: "main",
      };
      const book = createDemoBook();
      const progress = progressForLocator(
        book,
        {
          kind: "section",
          sectionId: book.sections[2]!.id,
          progression: 0.45,
        },
        123,
      );
      const state: ReaderState = {
        status: "ready",
        error: null,
        library: [book],
        activeBookId: book.id,
        activeSectionId: progress.locator.sectionId,
        navigationSequence: 0,
        navigationHistory: { back: [], forward: [] },
        searchScope: "library",
        progressByBook: { [book.id]: progress },
        bookmarksByBook: { [book.id]: [] },
        annotationsByBook: { [book.id]: [] },
        query: "",
        searchHits: [],
        searchBookId: null,
        searchActiveIndex: -1,
        searchBusy: false,
        searchReveal: null,
        settings: {
          ...DEFAULT_READER_SETTINGS,
          fontSize: 22,
          fontFamily: "kai",
          latinFontFamily: "serif",
        },
        sidebarOpen: false,
        searchOpen: false,
        lastSavedAt: null,
        saveError: null,
      };

      await persistReader(runtime, state);

      expect(values.has("bcr.reader.session.v1")).toBe(true);
      const restored = await restoreReader({
        ...runtime,
        meta: { kvGet: async () => undefined } as never,
      });
      expect(restored?.progressByBook[book.id]).toMatchObject({
        locator: { sectionId: book.sections[2]!.id, progression: 0.45 },
        percentage: progress.percentage,
      });
      expect(restored?.settings).toMatchObject({
        fontSize: 22,
        fontFamily: "kai",
        latinFontFamily: "serif",
      });
    });
  });
});
