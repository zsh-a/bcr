import { artifactStore, ArtifactStoreTag, type ArtifactRef } from "@bcr/core";
import { createDocumentContentPackage, stageById } from "@bcr/document-core";
import { Context, Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { importDocumentHandoff } from "../src/runtime";
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
});
