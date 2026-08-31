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
export async function hashReadableStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const hasher = createContentHasher();
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hasher.update(value);
    }
    return hasher.digest();
  } finally {
    reader.releaseLock();
  }
}
