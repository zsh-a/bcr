import type { ReaderBook, ReaderOpenInput, ReaderSection } from "@bcr/reader-core";
import { makeBook } from "./readerAdapterShared";
import { escapeHtml } from "./readerMarkup";
import { readTxtRange, scanTxt, searchTxt, type TxtRange, type TxtSearchHit } from "./txtIndex";

export const LAZY_TXT_MIN_BYTES = 256 * 1024;
const CACHE_BYTES = 4 * 1024 * 1024;
const CACHE_SECTIONS = 128;
interface Entry {
  text: string;
  html: string;
  bytes: number;
}
interface Source {
  file: Blob;
  ranges: readonly TxtRange[];
  cache: Map<number, Entry>;
  pending: Map<number, Promise<void>>;
  listeners: Map<number, Set<() => void>>;
  pins: Map<number, number>;
  bytes: number;
  inactive: boolean;
}
const sources = new WeakMap<ReaderSection, { source: Source; index: number }>();

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
  const ranges = await txtTask(input.file, () => scanTxt(input.file, input.signal), input.signal);
  return makeBook(input, attachTxtSections(input.file, ranges));
}

export function attachTxtSections(
  file: Blob,
  ranges: readonly TxtRange[],
): readonly ReaderSection[] {
  const source: Source = {
    file,
    ranges,
    cache: new Map(),
    pending: new Map(),
    listeners: new Map(),
    pins: new Map(),
    bytes: 0,
    inactive: false,
  };
  return ranges.map((range, index) => {
    const section: ReaderSection = {
      id: `section-${index + 1}`,
      order: index,
      label: `段落 ${index + 1}`,
      kind: "text",
      textRange: range,
      get text() {
        return source.cache.get(index)?.text ?? "";
      },
      get html() {
        return source.cache.get(index)?.html;
      },
    };
    sources.set(section, { source, index });
    return section;
  });
}

export function isLazyTxt(book: ReaderBook): boolean {
  return book.sections[0]?.textRange !== undefined;
}
export function txtSectionReady(section: ReaderSection | undefined): boolean {
  if (!section) return true;
  const binding = sources.get(section);
  return !binding || binding.source.cache.has(binding.index);
}
function evict(source: Source) {
  for (const [index, entry] of source.cache) {
    if (source.bytes <= CACHE_BYTES && source.cache.size <= CACHE_SECTIONS) break;
    if (source.pins.has(index)) continue;
    source.cache.delete(index);
    source.bytes -= entry.bytes;
  }
}
export async function loadTxtSection(section: ReaderSection): Promise<void> {
  const binding = sources.get(section);
  if (!binding) return;
  const { source, index } = binding;
  source.inactive = false;
  const cached = source.cache.get(index);
  if (cached) {
    source.cache.delete(index);
    source.cache.set(index, cached);
    return;
  }
  const pending = source.pending.get(index);
  if (pending) return pending;
  const job = readTxtRange(source.file, source.ranges[index]!)
    .then((text) => {
      if (source.inactive) return;
      const html = `<p>${escapeHtml(text).replace(/\n/gu, "<br />")}</p>`;
      const entry = { text, html, bytes: (text.length + html.length) * 2 };
      source.cache.set(index, entry);
      source.bytes += entry.bytes;
      evict(source);
      for (const listener of source.listeners.get(index) ?? []) listener();
    })
    .finally(() => source.pending.delete(index));
  source.pending.set(index, job);
  return job;
}
export function subscribeTxtSection(
  section: ReaderSection | undefined,
  listener: () => void,
): () => void {
  const binding = section && sources.get(section);
  if (!binding) return () => {};
  const { source, index } = binding;
  source.inactive = false;
  const listeners = source.listeners.get(index) ?? new Set();
  listeners.add(listener);
  source.listeners.set(index, listeners);
  source.pins.set(index, (source.pins.get(index) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    listeners.delete(listener);
    if (!listeners.size) source.listeners.delete(index);
    const pins = (source.pins.get(index) ?? 1) - 1;
    if (pins) source.pins.set(index, pins);
    else source.pins.delete(index);
    if (!source.pins.size) {
      source.inactive = true;
      source.cache.clear();
      source.bytes = 0;
    } else evict(source);
  };
}
export async function searchLazyTxt(
  book: ReaderBook,
  query: string,
  signal?: AbortSignal,
): Promise<TxtSearchHit[]> {
  const binding = book.sections[0] && sources.get(book.sections[0]);
  if (!binding) throw new Error("TXT 源文件不可用");
  const { file, ranges } = binding.source;
  return txtTask(
    file,
    () => searchTxt(file, ranges, book.id, query, signal),
    signal,
    ranges,
    book.id,
    query,
  );
}
/** Explicit full-document handoff only; never feeds the reading cache. */
export async function materializeTxt(book: ReaderBook): Promise<ReaderBook> {
  if (!isLazyTxt(book)) return book;
  const binding = book.sections[0] && sources.get(book.sections[0]);
  if (!binding) throw new Error("TXT 源文件不可用");
  const sections: ReaderSection[] = [];
  for (const section of book.sections) {
    const { textRange, ...metadata } = section;
    const text = await readTxtRange(binding.source.file, textRange!);
    sections.push({
      ...metadata,
      text,
      html: `<p>${escapeHtml(text).replace(/\n/gu, "<br />")}</p>`,
    });
  }
  return { ...book, sections };
}
