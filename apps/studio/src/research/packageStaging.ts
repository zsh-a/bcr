import { createContentHasher } from "@bcr/core";

export const IMPORT_MEMORY_LIMIT = 32 * 1024 * 1024;
const ROOT = "bcr-research-imports-v1";
const lockName = (id: string) => `bcr:research-import:${id}`;
export interface PackageStaging {
  readonly mode: "disk" | "memory";
  write(
    size: number,
    hash: string,
    extract: (stream: WritableStream<Uint8Array>) => Promise<unknown>,
  ): Promise<Blob>;
  acquire(): () => Promise<void>;
  dispose(): Promise<void>;
}
async function holdLock(id: string): Promise<() => Promise<void>> {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let ready!: () => void;
  let failed!: (error: unknown) => void;
  const acquired = new Promise<void>((resolve, reject) => {
    ready = resolve;
    failed = reject;
  });
  const task = navigator.locks.request(lockName(id), async () => {
    ready();
    await held;
  });
  void task.catch(failed);
  await acquired;
  return async () => {
    release();
    await task;
  };
}
async function removeDirectory(root: FileSystemDirectoryHandle, id: string) {
  try {
    await root.removeEntry(id, { recursive: true });
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error;
  }
}
async function sweep(root: FileSystemDirectoryHandle) {
  for await (const [id, handle] of root as unknown as AsyncIterable<[string, FileSystemHandle]>) {
    if (handle.kind !== "directory" || !/^[a-f0-9-]{36}$/u.test(id)) continue;
    await navigator.locks.request(lockName(id), { ifAvailable: true }, async (lock) => {
      if (lock) await removeDirectory(root, id);
    });
  }
}
function storageError(error: unknown): unknown {
  if (error instanceof DOMException && error.name === "QuotaExceededError")
    return new Error("临时存储空间不足，请释放空间或选择更小的分卷后重试。");
  return error;
}
export async function createPackageStaging(signal?: AbortSignal): Promise<PackageStaging> {
  signal?.throwIfAborted();
  let directory: FileSystemDirectoryHandle | undefined;
  let root: FileSystemDirectoryHandle | undefined;
  let unlock: (() => Promise<void>) | undefined;
  const id = crypto.randomUUID();
  const disk =
    typeof navigator !== "undefined" &&
    !!navigator.storage?.getDirectory &&
    !!navigator.locks?.request;
  if (disk) {
    try {
      root = await (
        await navigator.storage.getDirectory()
      ).getDirectoryHandle(ROOT, { create: true });
      await sweep(root);
      signal?.throwIfAborted();
      unlock = await holdLock(id);
      directory = await root.getDirectoryHandle(id, { create: true });
    } catch (error) {
      await unlock?.();
      throw storageError(error);
    }
  }
  let references = 1;
  let disposed = false;
  let used = 0;
  let index = 0;
  const release = async () => {
    references--;
    if (references !== 0) return;
    try {
      if (root) await removeDirectory(root, id);
    } finally {
      await unlock?.();
    }
  };
  const staging: PackageStaging = {
    mode: disk ? "disk" : "memory",
    acquire() {
      if (disposed) throw new Error("资料包临时文件已释放，请重新选择文件。");
      references++;
      let released = false;
      return async () => {
        if (!released) {
          released = true;
          await release();
        }
      };
    },
    async dispose() {
      if (!disposed) {
        disposed = true;
        await release();
      }
    },
    async write(size, hash, extract) {
      signal?.throwIfAborted();
      if (disposed) throw new Error("资料包临时文件已释放");
      if (!Number.isSafeInteger(size) || size < 0) throw new Error("资料包文件大小无效");
      if (!disk && used + size > IMPORT_MEMORY_LIMIT)
        throw new Error("当前环境无法安全使用临时文件，解包累计上限为 32 MiB，请选择更小的分卷。");
      used += size;
      let file: FileSystemFileHandle | undefined;
      let destination: FileSystemWritableFileStream | undefined;
      let bytes = 0;
      const chunks: BlobPart[] = [];
      const hasher = createContentHasher();
      let closed = false;
      try {
        if (directory) {
          const estimate = await navigator.storage.estimate?.();
          if (
            estimate?.quota !== undefined &&
            estimate.usage !== undefined &&
            size > estimate.quota - estimate.usage
          )
            throw new DOMException("quota", "QuotaExceededError");
          file = await directory.getFileHandle(String(index++), { create: true });
          destination = await file.createWritable();
        }
        const stream = new WritableStream<Uint8Array>({
          async write(chunk) {
            signal?.throwIfAborted();
            bytes += chunk.byteLength;
            if (bytes > size) throw new Error("资料包文件大小不符");
            for (let offset = 0; offset < chunk.byteLength; offset += 65536) {
              const part = chunk.subarray(offset, offset + 65536);
              hasher.update(part);
              if (destination) await destination.write(part as FileSystemWriteChunkType);
              else chunks.push(new Uint8Array(part));
            }
          },
          async close() {
            signal?.throwIfAborted();
            if (bytes !== size || hasher.digest() !== hash)
              throw new Error("资料包文件大小或哈希校验失败");
            await destination?.close();
            closed = true;
          },
          async abort(reason) {
            await destination?.abort(reason);
          },
        });
        await extract(stream);
        signal?.throwIfAborted();
        if (!closed) throw new Error("资料包解包未完成");
        return file ? await file.getFile() : new Blob(chunks);
      } catch (error) {
        if (!closed) await destination?.abort(error).catch(() => undefined);
        throw storageError(error);
      }
    },
  };
  if (signal?.aborted) {
    await staging.dispose();
    signal.throwIfAborted();
  }
  return staging;
}
