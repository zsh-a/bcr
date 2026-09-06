import { BlobReader, TextReader, ZipWriter } from "@zip.js/zip.js";
import { createContentHasher, hashReadableStream } from "@bcr/core";
import { PACKAGE_LIMIT, type ResearchPackagePlan } from "./researchPackage";

/** Owns the destination: close only after a complete archive; abort on any failure. */
export async function writeResearchPackage(
  plan: ResearchPackagePlan,
  destination: WritableStream<Uint8Array>,
  report: (message: string) => void,
  signal?: AbortSignal,
  volumeIndex = 0,
): Promise<void> {
  const task = new AbortController();
  const abort = () => task.abort(signal?.reason);
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const output = new TransformStream<Uint8Array, Uint8Array>();
  const draining = output.readable.pipeTo(destination, { signal: task.signal });
  // Observe sink failures immediately, including while preparing the first entry.
  void draining.catch((error) => task.abort(error));
  const zip = new ZipWriter(output.writable);
  let stopReader: (() => void) | undefined;
  let producing: Promise<void> | undefined;
  let adding: Promise<unknown> | undefined;
  try {
    task.signal.throwIfAborted();
    const volume = plan.volumes[volumeIndex];
    if (!volume) throw new Error("分卷编号无效");
    const { writeReaderTransfer } = await import("@bcr/reader-studio/research-transfer");
    const catalog = new Blob([JSON.stringify(plan.catalog)]);
    const research = new Blob([JSON.stringify(plan.backup)]);
    const options = { level: 0, signal: task.signal };
    const entries = [];
    for (const [path, blob] of [
      ["catalog.json", catalog],
      ["research.json", research],
    ] as const) {
      entries.push({
        path,
        size: blob.size,
        hash: await hashReadableStream(blob.stream(), { signal: task.signal }),
      });
      await zip.add(path, new BlobReader(blob), options);
    }
    if (entries[0]!.hash !== plan.set || entries[1]!.hash !== plan.catalog.researchHash)
      throw new Error("资料包快照已变化，请重新检查");
    const hasher = createContentHasher();
    let size = 0;
    const reader = new TransformStream<Uint8Array, Uint8Array>({
      start(controller) {
        stopReader = () => controller.error(task.signal.reason);
        task.signal.addEventListener("abort", stopReader, { once: true });
        if (task.signal.aborted) stopReader();
      },
      transform(chunk, controller) {
        task.signal.throwIfAborted();
        size += chunk.byteLength;
        if (size + catalog.size + research.size > PACKAGE_LIMIT)
          throw new Error("资料包超过 600 MiB 上限");
        hasher.update(chunk);
        report(`正在写入 Reader 资料 · ${(size / 1024 / 1024).toFixed(2)} MiB`);
        controller.enqueue(chunk);
      },
    });
    report("正在流式写入资料包…");
    producing = writeReaderTransfer(
      volume.books,
      reader.writable,
      report,
      volume.readerStamp,
      task.signal,
    );
    adding = zip.add("reader.zip", reader.readable, options);
    void producing.catch((error) => task.abort(error));
    void adding.catch((error) => task.abort(error));
    await Promise.all([producing, adding]);
    entries.push({ path: "reader.zip", size, hash: hasher.digest() });
    task.signal.throwIfAborted();
    await zip.add(
      "manifest.json",
      new TextReader(
        JSON.stringify({
          format: "bcr-research-package",
          version: 2,
          volume: { set: plan.set, index: volumeIndex + 1 },
          entries,
        }),
      ),
      options,
    );
    await zip.close();
    await draining;
  } catch (error) {
    task.abort(error);
    await Promise.allSettled([draining, producing, adding]);
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
    if (stopReader) task.signal.removeEventListener("abort", stopReader);
  }
}
