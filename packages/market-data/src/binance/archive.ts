import { TextWriter, Uint8ArrayReader, ZipReader } from "@zip.js/zip.js";

export const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
export interface VerifiedArchive {
  csv: string;
  checksum: string;
  url: string;
}
async function bytes(response: Response, signal: AbortSignal): Promise<Uint8Array> {
  if (Number(response.headers.get("Content-Length")) > MAX_ARCHIVE_BYTES)
    throw new Error("Binance 单个档案超过 32 MiB");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Binance 档案响应为空");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_ARCHIVE_BYTES) throw new Error("Binance 单个档案超过 32 MiB");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
export async function downloadArchive(
  url: string,
  signal: AbortSignal,
  request: typeof fetch = fetch,
): Promise<VerifiedArchive> {
  signal.throwIfAborted();
  const response = await request(url, { signal, credentials: "omit" });
  if (!response.ok)
    throw new Error(
      `Binance 档案尚未发布或不可用（HTTP ${response.status}）：${url.split("/").at(-1)}`,
    );
  const zipped = await bytes(response, signal);
  const check = await request(`${url}.CHECKSUM`, { signal, credentials: "omit" });
  if (!check.ok) throw new Error("Binance 档案校验文件不可用，未使用未验证数据");
  const checksum = (await check.text()).trim().split(/\s+/u)[0] ?? "";
  if (!/^[a-f0-9]{64}$/u.test(checksum)) throw new Error("Binance SHA-256 校验文件格式无效");
  const digest = await crypto.subtle.digest("SHA-256", zipped.buffer as ArrayBuffer);
  const actual = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  if (actual !== checksum) throw new Error("Binance 档案 SHA-256 校验失败，请重新获取");
  const zip = new ZipReader(new Uint8ArrayReader(zipped), { useWebWorkers: false });
  try {
    const entries = await zip.getEntries();
    const entry = entries[0];
    if (
      entries.length !== 1 ||
      !entry ||
      entry.directory ||
      !entry.filename.endsWith(".csv") ||
      entry.uncompressedSize > MAX_ARCHIVE_BYTES
    )
      throw new Error("Binance ZIP 必须包含一个不超过 32 MiB 的 CSV");
    const csv = await entry.getData(new TextWriter(), { signal, checkSignature: true });
    signal.throwIfAborted();
    return { csv, checksum, url };
  } finally {
    await zip.close();
  }
}
