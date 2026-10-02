import { hashReadableStream } from "@bcr/core";
export interface AttachmentImportResult {
  hash?: string;
  width?: number;
  height?: number;
  thumbnail?: Blob;
  error?: string;
}

/** File cloning keeps the original browser Blob backing; no file-sized transferable arrays. */
export async function processAttachment(
  file: File,
  image: boolean,
  digest = true,
  signal?: AbortSignal,
): Promise<AttachmentImportResult> {
  signal?.throwIfAborted();
  if (typeof Worker === "undefined")
    return digest ? { hash: await hashReadableStream(file.stream(), { signal }) } : {};
  const worker = new Worker(new URL("./attachmentImport.worker.ts", import.meta.url), {
    type: "module",
  });
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener("abort", abort);
      worker.terminate();
    };
    const abort = () => {
      finish();
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event) => {
      const value = event.data as AttachmentImportResult;
      finish();
      if (value.error) reject(new Error(value.error));
      else resolve(value);
    };
    worker.onerror = () => {
      finish();
      reject(new Error("附件处理 Worker 未能启动，请重试"));
    };
    worker.postMessage({ file, image, digest });
  });
}
