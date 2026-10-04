import { hashReadableStream } from "@bcr/core";
import type { BinaryStore } from "@bcr/storage-opfs";
import { Schema } from "effect";

export const ArtifactSchema = Schema.Struct({
  hash: Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/u)),
  name: Schema.String.pipe(Schema.maxLength(500)),
  mime: Schema.String.pipe(Schema.maxLength(120)),
  size: Schema.Number.pipe(Schema.int(), Schema.between(0, 300 * 1024 * 1024)),
});
export type WorkspaceFile = typeof ArtifactSchema.Type;

/** Durable, content-addressed files, independent of domains and the compute cache. */
export class WorkspaceFiles {
  constructor(private readonly storage: BinaryStore | undefined) {}
  async import(blob: Blob, name: string, signal?: AbortSignal): Promise<WorkspaceFile> {
    if (!this.storage) throw new Error("工作区文件存储不可用");
    if (blob.size > 300 * 1024 * 1024) throw new Error("单个文件超过 300 MiB");
    const artifact = Schema.decodeUnknownSync(ArtifactSchema)({
      hash: await hashReadableStream(blob.stream(), { signal }),
      name,
      mime: blob.type || "application/octet-stream",
      size: blob.size,
    });
    signal?.throwIfAborted();
    await this.storage.putStream(`workspace/files/${artifact.hash}`, blob.stream());
    return artifact;
  }
  async read(input: WorkspaceFile): Promise<Blob> {
    const file = Schema.decodeUnknownSync(ArtifactSchema)(input),
      store = this.storage;
    if (!store) throw new Error("工作区文件存储不可用");
    const read = (path: string) =>
      store.getBlob
        ? store.getBlob(path)
        : store.get(path).then((bytes) => (bytes ? new Blob([bytes as BlobPart]) : undefined));
    const blob = await read(`workspace/files/${file.hash}`);
    if (!blob || blob.size !== file.size || (await hashReadableStream(blob.stream())) !== file.hash)
      throw new Error("文件不存在或校验失败");
    return blob.slice(0, blob.size, file.mime);
  }
}
