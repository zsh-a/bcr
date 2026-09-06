import type { BinaryStore } from "./store";

/**
 * 内存版 BinaryStore：Node 测试与无 OPFS 环境的降级实现。
 */
export class MemoryStore implements BinaryStore {
  private readonly files = new Map<string, Uint8Array>();

  async put(path: string, data: Uint8Array): Promise<void> {
    this.files.set(normalize(path), data.slice());
  }

  async get(path: string): Promise<Uint8Array | undefined> {
    const data = this.files.get(normalize(path));
    return data?.slice();
  }

  async putStream(path: string, stream: ReadableStream<Uint8Array>): Promise<void> {
    const chunks: Uint8Array[] = [];
    await stream.pipeTo(
      new WritableStream({
        write(chunk) {
          chunks.push(chunk);
        },
      }),
    );
    this.files.set(normalize(path), concat(chunks));
  }

  async getStream(path: string): Promise<ReadableStream<Uint8Array> | undefined> {
    const data = this.files.get(normalize(path));
    if (data === undefined) return undefined;
    // Stored arrays are replaced, never mutated. Keep this snapshot and copy
    // only requested chunks so a streaming read does not duplicate the file.
    let offset = 0;
    return new ReadableStream({
      pull(controller) {
        if (offset >= data.byteLength) {
          controller.close();
          return;
        }
        const end = Math.min(offset + 64 * 1024, data.byteLength);
        controller.enqueue(data.slice(offset, end));
        offset = end;
      },
    });
  }

  async readRange(path: string, offset: number, length: number): Promise<Uint8Array> {
    const data = this.files.get(normalize(path));
    if (data === undefined) throw new Error(`not found: ${path}`);
    return data.slice(offset, offset + length);
  }

  async delete(path: string): Promise<void> {
    this.files.delete(normalize(path));
  }

  async has(path: string): Promise<boolean> {
    return this.files.has(normalize(path));
  }

  async list(prefix = ""): Promise<string[]> {
    const normalized = normalize(prefix);
    return [...this.files.keys()].filter((key) => key.startsWith(normalized));
  }

  async size(path: string): Promise<number | undefined> {
    const data = this.files.get(normalize(path));
    return data?.byteLength;
  }

  async getBlob(path: string): Promise<Blob | undefined> {
    const data = this.files.get(normalize(path));
    return data === undefined ? undefined : new Blob([data.slice() as BlobPart]);
  }
}

function normalize(path: string): string {
  return path.replace(/^\/+|\/+$/g, "");
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
