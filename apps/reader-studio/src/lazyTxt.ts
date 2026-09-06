import { attachReaderContent } from "./readerContent";
import type { ReaderBook, ReaderOpenInput, ReaderSection } from "@bcr/reader-core";
import { makeBook } from "./readerAdapterShared";
import { escapeHtml } from "./readerMarkup";
import { readTxtRange, scanTxtIndex, searchTxt, type TxtRange } from "./txtIndex";

export const LAZY_TXT_MIN_BYTES = 256 * 1024;
async function txtTask<T>(
  file: Blob,
  fallback: () => Promise<T>,
  signal?: AbortSignal,
  ranges?: readonly TxtRange[],
  bookId = "",
  query = "",
): Promise<T> {
  signal?.throwIfAborted();
  if (typeof Worker === "undefined") return fallback();
  let worker: Worker;
  try {
    worker = new Worker(new URL("./workers/reader-txt.worker.ts", import.meta.url), {
      type: "module",
    });
  } catch {
    return fallback();
  }
  return new Promise<T>((resolve, reject) => {
    const finish = () => {
      worker.terminate();
      signal?.removeEventListener("abort", abort);
    };
    const abort = () => {
      finish();
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    worker.onerror = () => {
      finish();
      fallback().then(resolve, reject);
    };
    worker.onmessage = (event: MessageEvent<{ value: T; error?: string }>) => {
      finish();
      if (event.data.error) reject(new Error(event.data.error));
      else resolve(event.data.value);
    };
    worker.postMessage({ file, ranges, bookId, query });
  });
}

export async function openLazyTxt(input: ReaderOpenInput): Promise<ReaderBook> {
  const index = await txtTask(
    input.file,
    () => scanTxtIndex(input.file, input.signal),
    input.signal,
  );
  return makeBook(input, attachTxtSections(input.file, index.ranges), { toc: index.toc });
}

export function attachTxtSections(
  file: Blob,
  ranges: readonly TxtRange[],
): readonly ReaderSection[] {
  const sections = ranges.map((range, index) => ({
    id: `section-${index + 1}`,
    order: index,
    label: `段落 ${index + 1}`,
    kind: "text" as const,
    textRange: range,
    text: "",
  }));
  return attachReaderContent(sections, {
    async read(index, signal) {
      signal.throwIfAborted();
      const text = await readTxtRange(file, ranges[index]!);
      signal.throwIfAborted();
      return { text, html: `<p>${escapeHtml(text).replace(/\n/gu, "<br />")}</p>` };
    },
    search: (bookId, query, signal) =>
      txtTask(
        file,
        () => searchTxt(file, ranges, bookId, query, signal),
        signal,
        ranges,
        bookId,
        query,
      ),
  });
}
