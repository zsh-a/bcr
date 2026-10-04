import { BlobReader, BlobWriter, TextReader, ZipReader, ZipWriter } from "@zip.js/zip.js";
import type { WorkspaceFiles } from "../workspace/files";
import { decodeWork, type Work } from "./model";

const LIMIT = 256 * 1024 * 1024;
export async function exportWork(work: Work, files: WorkspaceFiles, signal?: AbortSignal) {
  const zip = new ZipWriter(new BlobWriter("application/zip"));
  try {
    await zip.add("work.json", new TextReader(JSON.stringify(work, null, 2)), {
      useWebWorkers: false,
      ...(signal ? { signal } : {}),
    });
    for (const artifact of new Map(work.files.map((f) => [f.artifact.hash, f.artifact])).values()) {
      signal?.throwIfAborted();
      await zip.add(`files/${artifact.hash}`, new BlobReader(await files.read(artifact)), {
        useWebWorkers: false,
        ...(signal ? { signal } : {}),
      });
    }
    return await zip.close();
  } catch (error) {
    await zip.close().catch(() => undefined);
    throw error;
  }
}
/** Validate the entire archive before importing blobs or moving any head pointer. */
export async function readWorkArchive(blob: Blob, signal?: AbortSignal) {
  if (blob.size > LIMIT + 2 * 1024 * 1024) throw new Error("作品归档过大");
  const zip = new ZipReader(new BlobReader(blob));
  try {
    const entries = await zip.getEntries();
    if (
      entries.length > 201 ||
      new Set(entries.map((e) => e.filename)).size !== entries.length ||
      entries.some(
        (e) =>
          e.directory || e.encrypted || !/^(?:work\.json|files\/[a-f0-9]{64})$/u.test(e.filename),
      )
    )
      throw new Error("无效的作品归档条目");
    let total = 0;
    const extract = async (name: string, limit: number) => {
      const entry = entries.find((e) => e.filename === name);
      if (!entry || entry.directory || !entry.getData || entry.uncompressedSize > limit)
        throw new Error(`归档文件缺失或过大：${name}`);
      const chunks: BlobPart[] = [];
      let size = 0;
      await entry.getData(
        new WritableStream<Uint8Array>({
          write(chunk) {
            signal?.throwIfAborted();
            size += chunk.byteLength;
            total += chunk.byteLength;
            if (size > limit || total > LIMIT + 1024 * 1024)
              throw new Error("归档解压超过容量限制");
            chunks.push(chunk.slice() as BlobPart);
          },
        }),
        { ...(signal ? { signal } : {}), useWebWorkers: false, checkSignature: true },
      );
      if (size !== entry.uncompressedSize) throw new Error("归档文件大小不匹配");
      return new Blob(chunks);
    };
    const work = decodeWork(JSON.parse(await (await extract("work.json", 1024 * 1024)).text()));
    const blobs = new Map<string, Blob>();
    const { hashReadableStream } = await import("@bcr/core");
    for (const artifact of new Map(work.files.map((f) => [f.artifact.hash, f.artifact])).values()) {
      const data = await extract(`files/${artifact.hash}`, artifact.size);
      if (
        data.size !== artifact.size ||
        (await hashReadableStream(data.stream(), { signal })) !== artifact.hash
      )
        throw new Error("归档文件校验失败");
      blobs.set(artifact.hash, data);
    }
    if (entries.length !== blobs.size + 1) throw new Error("归档包含未引用的文件");
    return { work, blobs };
  } finally {
    await zip.close();
  }
}
