import { createContentHasher, hashReadableStream } from "@bcr/core";
import type { BinaryStore } from "@bcr/storage-opfs";
import {
  ATTACHMENT_FILE_LIMIT,
  attachmentPath,
  decodeAttachments,
  isPreviewImage,
  type KnowledgeAttachment,
} from "./attachmentModel";
import { processAttachment } from "./attachmentImport";

/** Binary files are written first. Only a verified file may be referenced by durable metadata. */
export class KnowledgeAttachments {
  private readonly previews = new Map<string, Promise<Blob>>();
  private persistenceRequested = false;
  constructor(private readonly binary: BinaryStore | undefined) {}
  private storage() {
    if (!this.binary) throw new Error("附件持久化不可用，请重新打开知识库");
    return this.binary;
  }
  async import(file: File, signal?: AbortSignal): Promise<KnowledgeAttachment> {
    if (file.size > ATTACHMENT_FILE_LIMIT) throw new Error("单个附件上限为 128 MiB");
    signal?.throwIfAborted();
    const mime = await detectMime(file);
    if (
      !this.persistenceRequested &&
      typeof navigator !== "undefined" &&
      navigator.storage?.persist
    ) {
      this.persistenceRequested = true;
      void navigator.storage.persist().catch(() => false);
    }
    const processed = await processAttachment(file, isPreviewImage(mime), true, signal);
    const hash = processed.hash;
    if (!hash) throw new Error("附件内容摘要缺失");
    const record: KnowledgeAttachment = {
      id: crypto.randomUUID(),
      hash,
      name:
        file.name
          .replace(/\p{Cc}/gu, " ")
          .trim()
          .slice(0, 500) || "附件",
      mime,
      size: file.size,
      createdAt: Date.now(),
    };
    // A preview failure must not discard a usable original file.
    if (processed.width && processed.height) {
      record.width = processed.width;
      record.height = processed.height;
    }
    decodeAttachments({ [record.id]: record });
    await this.put(record, file, signal);
    if (processed.thumbnail && mime !== "image/gif") {
      try {
        await this.storage().putStream(this.previewPath(hash), processed.thumbnail.stream());
      } catch {
        /* Previews can always be rebuilt. */
      }
    }
    return record;
  }
  async put(record: KnowledgeAttachment, blob: Blob, signal?: AbortSignal) {
    decodeAttachments({ [record.id]: record });
    if (blob.size !== record.size) throw new Error(`${record.name} 的附件校验失败`);
    signal?.throwIfAborted();
    const storage = this.storage(),
      path = `artifacts/${attachmentPath(record.hash)}`;
    const existing = await storage.size(path);
    if (existing !== undefined) {
      if ((await hashReadableStream(blob.stream(), { signal })) !== record.hash)
        throw new Error(`${record.name} 的附件校验失败`);
      const current = existing === record.size ? await this.get(record) : undefined;
      if (current && (await hashReadableStream(current.stream(), { signal })) === record.hash)
        return;
      // Re-importing verified identical bytes repairs a failed or damaged local write.
    }
    await storage.putStream(path, blob.stream().pipeThrough(this.checked(record, signal)));
  }
  private checked(record: KnowledgeAttachment, signal?: AbortSignal) {
    const hasher = createContentHasher();
    let bytes = 0;
    return new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, output) {
        signal?.throwIfAborted();
        bytes += chunk.length;
        if (bytes > record.size) throw new Error(`${record.name} 的附件大小不符`);
        hasher.update(chunk);
        output.enqueue(chunk);
      },
      flush() {
        signal?.throwIfAborted();
        if (bytes !== record.size || hasher.digest() !== record.hash)
          throw new Error(`${record.name} 的附件校验失败`);
      },
    });
  }
  /** Zip/API readers feed this channel with backpressure, without collecting file-sized arrays. */
  async extract(
    record: KnowledgeAttachment,
    produce: (sink: WritableStream<Uint8Array>) => Promise<unknown>,
  ) {
    decodeAttachments({ [record.id]: record });
    const storage = this.storage(),
      path = `artifacts/${attachmentPath(record.hash)}`;
    const channel = this.checked(record);
    const controller = new AbortController();
    let exists = await storage.has(path);
    if (exists) {
      try {
        await this.verify(record);
      } catch {
        exists = false;
      }
    }
    const readable = channel.readable.pipeThrough(new TransformStream<Uint8Array, Uint8Array>(), {
      signal: controller.signal,
    });
    const consume = exists
      ? readable.pipeTo(new WritableStream({ write() {} }))
      : storage.putStream(path, readable);
    // Attach rejection handlers before either producer or consumer can fail.
    try {
      await Promise.all([consume, Promise.resolve().then(() => produce(channel.writable))]);
    } catch (error) {
      controller.abort(error);
      await consume.catch(() => undefined);
      throw error;
    }
  }
  async get(record: KnowledgeAttachment): Promise<Blob | undefined> {
    const storage = this.storage(),
      path = `artifacts/${attachmentPath(record.hash)}`;
    const blob = storage.getBlob
      ? await storage.getBlob(path)
      : await storage
          .get(path)
          .then((bytes) => (bytes === undefined ? undefined : new Blob([bytes as BlobPart])));
    if (blob && blob.size !== record.size) throw new Error(`${record.name} 的文件长度不符`);
    return blob?.slice(0, blob.size, record.mime);
  }
  async require(record: KnowledgeAttachment) {
    const blob = await this.get(record);
    if (!blob) throw new Error(`缺少附件：${record.name}。请同步或从完整备份恢复。`);
    return blob;
  }
  async verify(record: KnowledgeAttachment) {
    const blob = await this.require(record);
    if ((await hashReadableStream(blob.stream())) !== record.hash)
      throw new Error(`${record.name} 的附件校验失败`);
    return blob;
  }
  private previewPath(hash: string) {
    return `artifacts/knowledge/attachments/previews/${hash}.webp`;
  }
  preview(record: KnowledgeAttachment) {
    const existing = this.previews.get(record.hash);
    if (existing) return existing;
    const operation = (async () => {
      if (!isPreviewImage(record.mime) || record.mime === "image/gif") return this.require(record);
      const storage = this.storage(),
        path = this.previewPath(record.hash);
      const stored = storage.getBlob ? await storage.getBlob(path) : undefined;
      if (stored) return stored.slice(0, stored.size, "image/webp");
      const original = await this.require(record);
      if (original.size < 2 * 1024 * 1024 && (record.width ?? 0) <= 1600) return original;
      const result = await processAttachment(
        new File([original], record.name, { type: record.mime }),
        true,
        false,
      );
      if (!result.thumbnail) return original;
      try {
        await storage.putStream(path, result.thumbnail.stream());
      } catch {
        /* The current preview remains usable. */
      }
      return result.thumbnail;
    })();
    this.previews.set(record.hash, operation);
    void operation.finally(() => this.previews.delete(record.hash)).catch(() => undefined);
    return operation;
  }
}
async function detectMime(file: File) {
  const bytes = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  const text = new TextDecoder("latin1").decode(bytes);
  if (bytes[0] === 0x89 && text.slice(1, 4) === "PNG") return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (text.startsWith("GIF8")) return "image/gif";
  if (text.startsWith("RIFF") && text.slice(8, 12) === "WEBP") return "image/webp";
  if (text.startsWith("%PDF-")) return "application/pdf";
  if (text.slice(4, 8) === "ftyp" && /avif|avis/u.test(text.slice(8))) return "image/avif";
  if (text.startsWith("BM")) return "image/bmp";
  const mime = file.type.toLowerCase();
  // Arbitrary active content is retained as a downloadable file, never rendered as a document.
  return /^[a-z\d!#$&^_.+-]+\/[a-z\d!#$&^_.+-]+$/u.test(mime) && !isPreviewImage(mime)
    ? mime
    : "application/octet-stream";
}
