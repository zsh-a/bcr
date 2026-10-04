import { hashReadableStream } from "@bcr/core";
import type { BinaryStore } from "@bcr/storage-opfs";
import { Schema } from "effect";
import { AssetSchema, type ContentAsset } from "./model";

export const ArtifactSchema = Schema.Struct({
  hash: Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/u)),
  name: Schema.String.pipe(Schema.maxLength(500)),
  mime: Schema.String.pipe(Schema.maxLength(120)),
  size: Schema.Number.pipe(Schema.int(), Schema.between(0, 300 * 1024 * 1024)),
});
export type ContentArtifact = typeof ArtifactSchema.Type;

/** Owned immutable assets live outside the compute cache and survive cache collection. */
export class ContentAssets {
  constructor(private readonly storage: BinaryStore | undefined) {}
  private store() {
    if (!this.storage) throw new Error("项目文件存储不可用");
    return this.storage;
  }
  async importArtifact(blob: Blob, name: string, signal?: AbortSignal): Promise<ContentArtifact> {
    const artifact = Schema.decodeUnknownSync(ArtifactSchema)({
      hash: await hashReadableStream(blob.stream(), { signal }),
      name,
      mime: blob.type || "application/octet-stream",
      size: blob.size,
    });
    signal?.throwIfAborted();
    await this.store().putStream(`content/exports/${artifact.hash}`, blob.stream());
    return artifact;
  }
  async readArtifact(input: ContentArtifact): Promise<Blob> {
    const artifact = Schema.decodeUnknownSync(ArtifactSchema)(input),
      store = this.store(),
      path = `content/exports/${artifact.hash}`;
    const blob = store.getBlob
      ? await store.getBlob(path)
      : await store.get(path).then((bytes) => (bytes ? new Blob([bytes as BlobPart]) : undefined));
    if (
      !blob ||
      blob.size !== artifact.size ||
      (await hashReadableStream(blob.stream())) !== artifact.hash
    )
      throw new Error("导出文件不存在或校验失败");
    return blob.slice(0, blob.size, artifact.mime);
  }
  private path(asset: ContentAsset) {
    Schema.decodeUnknownSync(AssetSchema)(asset);
    return `content/assets/${asset.hash}`;
  }
  async import(blob: Blob, name: string, signal?: AbortSignal): Promise<ContentAsset> {
    if (blob.size > 16 * 1024 * 1024) throw new Error("首版单个项目素材上限为 16 MiB");
    const asset = {
      hash: await hashReadableStream(blob.stream(), { signal }),
      name,
      mime: blob.type || "application/octet-stream",
      size: blob.size,
    };
    await this.put(asset, blob, signal);
    return asset;
  }
  async put(asset: ContentAsset, blob: Blob, signal?: AbortSignal) {
    const path = this.path(asset);
    if (
      blob.size !== asset.size ||
      (await hashReadableStream(blob.stream(), { signal })) !== asset.hash
    )
      throw new Error(`文件校验失败：${asset.name}`);
    signal?.throwIfAborted();
    // A failed earlier write can be repaired with the exact same verified bytes.
    await this.store().putStream(path, blob.stream());
  }
  async read(asset: ContentAsset): Promise<Blob> {
    const store = this.store(),
      path = this.path(asset);
    const blob = store.getBlob
      ? await store.getBlob(path)
      : await store.get(path).then((bytes) => (bytes ? new Blob([bytes as BlobPart]) : undefined));
    if (
      !blob ||
      blob.size !== asset.size ||
      (await hashReadableStream(blob.stream())) !== asset.hash
    )
      throw new Error(`项目素材缺失或损坏：${asset.name}`);
    return blob.slice(0, blob.size, asset.mime);
  }
}
