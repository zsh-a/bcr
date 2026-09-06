import { blake3 } from "@noble/hashes/blake3.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/** BCR 内容寻址统一使用的 BLAKE3 十六进制摘要。 */
export function contentHash(data: Uint8Array): string {
  return bytesToHex(blake3(data));
}

export interface ContentHasher {
  update(data: Uint8Array): void;
  digest(): string;
}

/** 大型派生产物写入时同步累计摘要。digest() 只能调用一次。 */
export function createContentHasher(): ContentHasher {
  const hasher = blake3.create();
  return {
    update: (data) => hasher.update(data),
    digest: () => bytesToHex(hasher.digest()),
  };
}

/**
 * 流式计算大对象摘要，不把整个 File / Blob 聚合为 ArrayBuffer。
 * ReadableStream 在返回后已被消费；File 等可重开数据源应重新调用 stream() 写入存储。
 */
export async function hashReadableStream(
  stream: ReadableStream<Uint8Array>,
  options: {
    readonly signal?: AbortSignal | undefined;
    readonly onProgress?: (bytes: number) => void;
  } = {},
): Promise<string> {
  const hasher = createContentHasher();
  const reader = stream.getReader();
  const { signal, onProgress } = options;
  const abort = () => {
    void reader.cancel(signal?.reason).catch(() => undefined);
  };
  signal?.addEventListener("abort", abort, { once: true });
  let bytes = 0;
  let yieldedAt = Date.now();
  try {
    if (signal?.aborted) abort();
    signal?.throwIfAborted();
    onProgress?.(0);
    for (;;) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      for (let offset = 0; offset < value.length; offset += 1024 * 1024) {
        const chunk = value.subarray(offset, offset + 1024 * 1024);
        hasher.update(chunk);
        bytes += chunk.length;
        onProgress?.(bytes);
        // Buffered streams otherwise keep the main thread in microtasks,
        // preventing a click on Cancel from delivering its abort signal.
        if ((signal || onProgress) && Date.now() - yieldedAt >= 16) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          yieldedAt = Date.now();
        }
        signal?.throwIfAborted();
      }
    }
    return hasher.digest();
  } catch (error) {
    void reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}
