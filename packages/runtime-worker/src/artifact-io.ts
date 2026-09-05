import type { ArtifactStorage } from "@bcr/core";
import { artifactPath, contentHash, type ArtifactRef } from "@bcr/core";
import type { BinaryStore } from "@bcr/storage-opfs";
import type { WorkerContext } from "./worker";

/** Shared storage and serialization boundary for domain-specific compute tasks. */
export const WINDOW = 4 * 1024 * 1024;

export function throwIfAborted(ctx: WorkerContext): void {
  if (ctx.signal.aborted) throw new Error("cancelled");
}

export function sizeOf(task: { config?: Record<string, unknown> | undefined }): number {
  const size = task.config?.["sizeBytes"];
  return typeof size === "number" && size > 0 ? size : 0;
}

export function configString(
  task: { config?: Record<string, unknown> | undefined },
  key: string,
): string {
  const value = task.config?.[key];
  return typeof value === "string" ? value : "";
}

export function configNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function configText(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

export function configBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function createArtifactIO(store: BinaryStore, storage: ArtifactStorage) {
  async function getBlob(ref: ArtifactRef): Promise<Blob> {
    const blob = await store.getBlob?.(artifactPath(ref));
    if (blob !== undefined && blob !== null) return blob;
    const bytes = await store.get(artifactPath(ref));
    if (bytes === undefined) throw new Error(`Artifact not found: ${ref.id}`);
    return new Blob([bytes.slice().buffer as ArrayBuffer]);
  }
  async function readJsonArtifact<T>(ref: ArtifactRef, ctx: WorkerContext): Promise<T> {
    const chunks: Uint8Array[] = [];
    let offset = 0;
    for (;;) {
      throwIfAborted(ctx);
      const chunk = await store.readRange(artifactPath(ref), offset, WINDOW);
      if (chunk.byteLength === 0) break;
      chunks.push(chunk);
      offset += chunk.byteLength;
    }
    const bytes = new Uint8Array(offset);
    let cursor = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, cursor);
      cursor += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  }

  async function writeTypedJsonArtifact(
    namespace: string,
    kind: string,
    type: string,
    payload: unknown,
  ): Promise<ArtifactRef> {
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    const hash = contentHash(bytes);
    const out: ArtifactRef = {
      id: `${namespace}/${kind}/${hash}`,
      type,
      storage,
      format: "json",
      hash,
    };
    await store.put(artifactPath(out), bytes);
    return out;
  }
  return { store, storage, getBlob, readJsonArtifact, writeTypedJsonArtifact };
}

export type ArtifactIO = ReturnType<typeof createArtifactIO>;
