import type { BinaryStore } from "./store";

/** OPFS 可用性探测（§11：无 OPFS 时由上层降级到 MemoryStore）。 */
export function isOpfsSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "storage" in navigator &&
    typeof navigator.storage?.getDirectory === "function"
  );
}

/**
 * OPFS 版 BinaryStore（§8：project/artifacts|cache|models|temp 目录树）。
 *
 * 路径中的 `/` 映射为嵌套目录；大对象读写一律走 stream / readRange，
 * 不做整段装载（§4 的三级数据通道约束）。
 */
export class OpfsStore implements BinaryStore {
  private rootPromise: Promise<FileSystemDirectoryHandle> | undefined;

  constructor(private readonly prefix = "") {}

  private root(): Promise<FileSystemDirectoryHandle> {
    this.rootPromise ??= navigator.storage
      .getDirectory()
      .then((dir) => (this.prefix ? resolveDir(dir, this.prefix, true) : dir));
    return this.rootPromise;
  }

  async put(path: string, data: Uint8Array): Promise<void> {
    const file = await this.resolveFile(path, true);
    if (file === undefined) throw new Error(`cannot create: ${path}`);
    const writable = await file.createWritable();
    await writable.write(data as unknown as FileSystemWriteChunkType);
    await writable.close();
  }

  async get(path: string): Promise<Uint8Array | undefined> {
    const file = await this.resolveFile(path, false);
    if (file === undefined) return undefined;
    const blob = await file.getFile();
    return new Uint8Array(await blob.arrayBuffer());
  }

  async putStream(path: string, stream: ReadableStream<Uint8Array>): Promise<void> {
    const file = await this.resolveFile(path, true);
    if (file === undefined) throw new Error(`cannot create: ${path}`);
    const writable = await file.createWritable();
    await stream.pipeTo(
      new WritableStream({
        async write(chunk) {
          await writable.write(chunk as unknown as FileSystemWriteChunkType);
        },
        async close() {
          await writable.close();
        },
        async abort(reason) {
          await writable.abort(reason);
        },
      }),
    );
  }

  async getStream(path: string): Promise<ReadableStream<Uint8Array> | undefined> {
    const file = await this.resolveFile(path, false);
    if (file === undefined) return undefined;
    const blob = await file.getFile();
    return blob.stream();
  }

  async readRange(path: string, offset: number, length: number): Promise<Uint8Array> {
    const file = await this.resolveFile(path, false);
    if (file === undefined) throw new Error(`not found: ${path}`);
    const blob = await file.getFile();
    return new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer());
  }

  async delete(path: string): Promise<void> {
    const segments = split(path);
    const name = segments.pop();
    if (name === undefined) return;
    const dir = await this.resolveDir(segments, false);
    if (dir === undefined) return;
    try {
      await dir.removeEntry(name);
    } catch {
      // 不存在则视为已删除
    }
  }

  async has(path: string): Promise<boolean> {
    return (await this.resolveFile(path, false)) !== undefined;
  }

  async size(path: string): Promise<number | undefined> {
    const file = await this.resolveFile(path, false);
    if (file === undefined) return undefined;
    return (await file.getFile()).size;
  }

  async list(prefix = ""): Promise<string[]> {
    const root = await this.root();
    const base = await this.resolveDir(split(prefix), false);
    if (base === undefined) return [];
    const results: string[] = [];
    await walk(root, base, prefix.replace(/^\/+|\/+$/g, ""), results);
    return results;
  }

  private async resolveFile(
    path: string,
    create: boolean,
  ): Promise<FileSystemFileHandle | undefined> {
    const segments = split(path);
    const name = segments.pop();
    if (name === undefined) throw new Error(`invalid path: ${path}`);
    const dir = await this.resolveDir(segments, create);
    if (dir === undefined) return undefined;
    try {
      return await dir.getFileHandle(name, { create });
    } catch {
      return undefined;
    }
  }

  private async resolveDir(
    segments: string[],
    create: boolean,
  ): Promise<FileSystemDirectoryHandle | undefined> {
    const root = await this.root();
    try {
      return await resolveDir(root, segments.join("/"), create);
    } catch {
      return undefined;
    }
  }
}

function split(path: string): string[] {
  return path.split("/").filter((segment) => segment.length > 0);
}

async function resolveDir(
  root: FileSystemDirectoryHandle,
  path: string,
  create: boolean,
): Promise<FileSystemDirectoryHandle> {
  let dir = root;
  for (const segment of split(path)) {
    dir = await dir.getDirectoryHandle(segment, { create });
  }
  return dir;
}

async function walk(
  root: FileSystemDirectoryHandle,
  dir: FileSystemDirectoryHandle,
  prefix: string,
  results: string[],
): Promise<void> {
  void root;
  for await (const [name, handle] of dir as unknown as AsyncIterable<[string, FileSystemHandle]>) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === "file") {
      results.push(path);
    } else {
      await walk(root, handle as FileSystemDirectoryHandle, path, results);
    }
  }
}
