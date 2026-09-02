import { artifactStore, ArtifactStoreTag, type ArtifactRef } from "@bcr/core";
import {
  createDocumentContentPackage,
  createDocumentJob,
  markReadyStages,
  stageById,
  updateStage,
} from "@bcr/document-core";
import { Context, Effect, Layer, Stream } from "effect";
import { describe, expect, it } from "vitest";
import {
  canRunDocumentStage,
  importDocumentHandoff,
  preloadDocumentOcrModel,
  saveDocumentOcrReview,
} from "../src/runtime";
import { documents } from "../src/store";
import type { RuntimeServices } from "@bcr/react";

class TestBinaryStore {
  private readonly files = new Map<string, Uint8Array>();

  async put(path: string, data: Uint8Array): Promise<void> {
    this.files.set(path, data.slice());
  }

  async get(path: string): Promise<Uint8Array | undefined> {
    return this.files.get(path)?.slice();
  }

  async putStream(path: string, stream: ReadableStream<Uint8Array>): Promise<void> {
    const response = new Response(stream);
    this.files.set(path, new Uint8Array(await response.arrayBuffer()));
  }

  async getStream(path: string): Promise<ReadableStream<Uint8Array> | undefined> {
    const value = this.files.get(path);
    return value === undefined
      ? undefined
      : new ReadableStream({
          start: (controller) => {
            controller.enqueue(value.slice());
            controller.close();
          },
        });
  }

  async readRange(path: string, offset: number, length: number): Promise<Uint8Array> {
    const value = this.files.get(path);
    if (value === undefined) throw new Error(`not found: ${path}`);
    return value.slice(offset, offset + length);
  }

  async delete(path: string): Promise<void> {
    this.files.delete(path);
  }

  async has(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async list(prefix = ""): Promise<string[]> {
    return [...this.files.keys()].filter((key) => key.startsWith(prefix));
  }

  async size(path: string): Promise<number | undefined> {
    return this.files.get(path)?.byteLength;
  }

  async getBlob(path: string): Promise<Blob | undefined> {
    const value = this.files.get(path);
    return value === undefined ? undefined : new Blob([value.slice() as BlobPart]);
  }
}

async function makeServices(store: TestBinaryStore): Promise<RuntimeServices> {
  const context = await Effect.runPromise(
    Effect.scoped(Layer.build(artifactStore({ opfs: store, memory: new TestBinaryStore() }))),
  );
  return {
    artifacts: Context.get(context, ArtifactStoreTag),
    scheduler: undefined as never,
  };
}

describe("Document durable handoff import", () => {
  it("runs image OCR from the source and unlocks translation from its content Artifact", () => {
    const sourceRef: ArtifactRef = {
      id: "document/source/scan",
      type: "file/png",
      storage: "opfs",
      format: "image/png",
      hash: "scan-hash",
    };
    const job = markReadyStages(
      createDocumentJob({
        id: "document-scan",
        name: "scan.png",
        format: "image",
        size: 12,
        sourceRef,
        now: 1,
      }),
    );
    expect(canRunDocumentStage(job, "ocr")).toBe(true);
    const withOcr = updateStage(job, "ocr", {
      status: "done",
      progress: 1,
      artifact: {
        id: "document/ocr/content",
        type: "document/content-package",
        storage: "opfs",
        format: "json",
      },
    });
    expect(canRunDocumentStage(withOcr, "translate")).toBe(true);
  });

  it("preloads an OCR model through the shared scheduler", async () => {
    const store = new TestBinaryStore();
    const services = await makeServices(store);
    const submitted: Array<{ operation: string; config?: Record<string, unknown> }> = [];
    const handle = {
      taskId: "document-ocr-preload-test",
      events: Stream.empty,
      await: Effect.succeed([]),
      cancel: Effect.void,
      cached: false,
    };
    const scheduler = {
      submit: (task: { operation: string; config?: Record<string, unknown> }) => {
        submitted.push(task);
        return Effect.succeed(handle);
      },
    };
    await preloadDocumentOcrModel(
      { artifacts: services.artifacts, scheduler: scheduler as never },
      {
        adapter: "manga.onnx",
        model: "onnx-community/manga-ocr-base-ONNX",
        device: "wasm",
        sourceLanguage: "ja",
      },
    );
    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toMatchObject({
      operation: "manga.model.preload",
      config: {
        kind: "ocr",
        adapter: "manga.onnx",
        sourceLanguage: "ja",
        device: "wasm",
      },
    });
  });

  it("persists OCR text review and invalidates downstream stages", async () => {
    const store = new TestBinaryStore();
    const services = await makeServices(store);
    const sourceRef: ArtifactRef = {
      id: "document/source/review-scan",
      type: "file/png",
      storage: "opfs",
      format: "image/png",
      hash: "review-scan-hash",
    };
    const job = markReadyStages(
      createDocumentJob({
        id: "document-ocr-review",
        name: "review-scan.png",
        format: "image",
        size: 12,
        sourceRef,
        now: 1,
      }),
    );
    const content = createDocumentContentPackage({
      id: "document-content/review-scan",
      format: "image",
      sourceName: "review-scan.png",
      sourceRef,
      adapter: "document.ocr.onnx",
      blocks: [
        {
          id: "page-1",
          label: "Page 1",
          text: "raw OCR",
          geometry: { x: 0, y: 0, width: 100, height: 100 },
        },
      ],
    });
    const ready = updateStage(job, "ocr", {
      status: "done",
      progress: 1,
      artifact: {
        id: "document/content/original",
        type: "document/content-package",
        storage: "opfs",
        format: "json",
      },
    });
    documents.addJob(ready);
    try {
      await saveDocumentOcrReview(services, ready, content, { "page-1": "reviewed OCR" });
      const current = documents.getJob(ready.id);
      expect(stageById(current!.stages, "ocr")).toMatchObject({
        status: "done",
        adapter: "document.ocr.review",
        artifact: { type: "document/content-package" },
      });
      expect(stageById(current!.stages, "translate")).toMatchObject({
        status: "idle",
        progress: 0,
      });
    } finally {
      documents.removeJob(ready.id);
    }
  });

  it("rebuilds a Reader projection as a completed Extract stage", async () => {
    const services = await makeServices(new TestBinaryStore());
    const sourceRef: ArtifactRef = {
      id: "reader/source/book",
      type: "file/publication",
      storage: "opfs",
      format: "text/markdown",
      hash: "source-hash",
    };
    const content = createDocumentContentPackage({
      id: "reader/book",
      format: "markdown",
      sourceName: "book.md",
      sourceRef,
      adapter: "reader.projection",
      blocks: [{ id: "chapter-1", label: "第一章", text: "Hello world" }],
    });
    const contentBytes = new TextEncoder().encode(JSON.stringify(content));
    const contentRef: ArtifactRef = {
      id: "document/content/reader/book",
      type: "document/content-package",
      storage: "opfs",
      format: "json",
    };
    await Effect.runPromise(services.artifacts.put(sourceRef, new TextEncoder().encode("# Book")));
    await Effect.runPromise(services.artifacts.put(contentRef, contentBytes));

    const { job, file } = await importDocumentHandoff(services, {
      id: "handoff-document-test",
      jobId: "reader-book",
      target: "document",
      name: "book.md",
      format: "markdown",
      size: 6,
      sourceRef,
      contentRef,
      createdAt: 1,
    });

    expect(file.name).toBe("book.md");
    expect(file.type).toBe("text/markdown");
    expect(job.id).toBe("document-handoff-handoff-document-test");
    expect(job.sourceRef?.id).toMatch(/^document\/source\//u);
    expect(stageById(job.stages, "extract")).toMatchObject({
      status: "done",
      progress: 1,
      artifact: contentRef,
      adapter: "reader.projection",
    });
    expect(job.sourceTextPreview).toBe("Hello world");
  });

  it("closes the OCR stage when Manga hands back a visual content package", async () => {
    const services = await makeServices(new TestBinaryStore());
    const sourceRef: ArtifactRef = {
      id: "manga/source/page",
      type: "file/png",
      storage: "opfs",
      format: "image/png",
      hash: "manga-source-hash",
    };
    const content = createDocumentContentPackage({
      id: "manga-page-content",
      format: "image",
      sourceName: "page-01.png",
      sourceRef,
      adapter: "manga.review.regions",
      blocks: [
        {
          id: "region-1",
          label: "气泡 1",
          text: "こんにちは",
          geometry: { x: 10, y: 20, width: 30, height: 15 },
          writingMode: "vertical-rl",
          confidence: 0.98,
        },
      ],
    });

    await Effect.runPromise(services.artifacts.put(sourceRef, new Uint8Array([137, 80, 78, 71])));
    const { job } = await importDocumentHandoff(services, {
      id: "handoff-manga-ocr-test",
      jobId: "manga-page",
      target: "document",
      name: "page-01.png",
      format: "image",
      size: 4,
      sourceRef,
      content,
      createdAt: 1,
    });

    expect(stageById(job.stages, "extract")).toMatchObject({
      status: "done",
      artifact: { type: "document/content-package" },
      adapter: "manga.review.regions",
    });
    expect(stageById(job.stages, "ocr")).toMatchObject({
      status: "done",
      progress: 1,
      capability: "adapter",
      artifact: { type: "document/content-package" },
      adapter: "manga.review.regions",
      execution: {
        runtime: "wasm",
        operation: "manga.review.regions",
        cache: "disabled",
      },
    });
  });

  it("keeps OCR blocked for an image package without Manga provenance", async () => {
    const services = await makeServices(new TestBinaryStore());
    const sourceRef: ArtifactRef = {
      id: "image/source/photo",
      type: "file/png",
      storage: "opfs",
      format: "image/png",
      hash: "photo-source-hash",
    };
    const content = createDocumentContentPackage({
      id: "photo-content",
      format: "image",
      sourceName: "photo.png",
      sourceRef,
      adapter: "external.import",
      blocks: [{ id: "caption", label: "Caption", text: "A photo" }],
    });

    await Effect.runPromise(services.artifacts.put(sourceRef, new Uint8Array([1, 2, 3])));
    const { job } = await importDocumentHandoff(services, {
      id: "handoff-image-content-test",
      jobId: "photo",
      target: "document",
      name: "photo.png",
      format: "image",
      size: 3,
      sourceRef,
      content,
      createdAt: 1,
    });

    expect(stageById(job.stages, "ocr")).toMatchObject({
      status: "blocked",
      capability: "planned",
    });
  });
});
