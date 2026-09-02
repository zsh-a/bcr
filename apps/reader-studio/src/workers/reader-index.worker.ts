import type { ComputeTask, ArtifactRef } from "@bcr/core";
import { defineWorker, type WorkerContext } from "@bcr/runtime-worker";
import { buildSearchIndex, type ReaderIndexDocument } from "@bcr/reader-core";

interface IndexBookPayload {
  readonly id: string;
  readonly sections: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly text: string;
  }>;
}

interface IndexResult {
  readonly version: 1;
  readonly bookId: string;
  readonly signature: string;
  readonly documents: ReadonlyArray<ReaderIndexDocument>;
}

function configOf(task: ComputeTask, key: string): unknown {
  return task.config?.[key];
}

function isIndexBookPayload(value: unknown): value is IndexBookPayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { id?: unknown; sections?: unknown };
  if (typeof candidate.id !== "string" || !Array.isArray(candidate.sections)) return false;
  return candidate.sections.every((section) => {
    if (typeof section !== "object" || section === null) return false;
    const item = section as { id?: unknown; label?: unknown; text?: unknown };
    return (
      typeof item.id === "string" && typeof item.label === "string" && typeof item.text === "string"
    );
  });
}

function throwIfAborted(ctx: WorkerContext): void {
  if (ctx.signal.aborted) throw new Error("cancelled");
}

async function indexReaderBook(
  task: ComputeTask,
  ctx: WorkerContext,
): Promise<ReadonlyArray<ArtifactRef>> {
  const payload = configOf(task, "book");
  if (!isIndexBookPayload(payload)) throw new Error("reader.index requires a valid book payload");
  throwIfAborted(ctx);
  const signature = configOf(task, "signature");
  if (typeof signature !== "string" || signature.length === 0) {
    throw new Error("reader.index requires a content signature");
  }
  const documents = buildSearchIndex(payload, (value) => {
    throwIfAborted(ctx);
    ctx.progress(value);
  });
  const result: IndexResult = { version: 1, bookId: payload.id, signature, documents };
  const bytes = new TextEncoder().encode(JSON.stringify(result));
  const output = task.outputs[0];
  const ref: ArtifactRef = {
    id: `reader/index/${payload.id}/${task.id}`,
    type: output?.type ?? "reader/search-index",
    storage: "memory",
    format: "json",
  };
  ctx.emitChunk(ref, bytes);
  ctx.progress(1);
  return [ref];
}

defineWorker({
  "reader.index": indexReaderBook,
});
