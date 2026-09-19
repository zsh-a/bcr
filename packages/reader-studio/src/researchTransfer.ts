import { MemoryStore } from "@bcr/storage-opfs";
import { sanitizeHtml } from "./readerMarkup";
import { DEFAULT_READER_SETTINGS } from "./model";
import { Effect } from "effect";
import { textVersion, hashReadableStream } from "@bcr/core";
import {
  createReaderBackup,
  writeReaderBackup,
  decodeReaderBackup,
  readerBackupManifest,
  planReaderBackup,
  prepareReaderRestore,
  type PreparedReaderBackup,
} from "./readerBackup";
import { readerRuntime } from "./readerRuntimeCore";
import { getReaderState, releaseBookResources } from "./store";
import { persistBook, restoreSectionSnapshots } from "./readerPersistence";
import { commitReaderBooks, persistReaderSnapshot } from "./readerPersistenceQueue";
import { indexBook } from "./readerSearch";
export { inspectReaderBackup, decodeReaderBackup } from "./readerBackup";
export type { PreparedReaderBackup } from "./readerBackup";

export function readerTransferState() {
  const runtime = readerRuntime();
  const state = getReaderState();
  if (!runtime || state.status !== "ready")
    throw new Error("请先打开 Reader，待书库加载完成后再使用完整资料包");
  return { runtime, state };
}
function transferSnapshot(
  book: ReturnType<typeof readerTransferState>["state"]["library"][number],
) {
  const snapshot = persistBook(book);
  const sections = snapshot.sections.map((section) => {
    if (section.html === undefined) return section;
    return { ...section, html: sanitizeHtml(section.html).html };
  });
  return { ...snapshot, sections };
}
export function readerTransferStamp(ids: ReadonlyArray<string>): string {
  const selected = new Set(ids);
  const books = readerTransferState().state.library.filter((book) => selected.has(book.id));
  return textVersion(JSON.stringify(books.map(transferSnapshot)));
}
export async function checkReaderTransfer(
  ids: ReadonlyArray<string>,
  report: (message: string) => void = () => {},
  signal?: AbortSignal,
): Promise<string[]> {
  signal?.throwIfAborted();
  const { state, runtime } = readerTransferState();
  const missing: string[] = [];
  for (const id of ids) {
    signal?.throwIfAborted();
    const book = state.library.find((item) => item.id === id),
      ref = book?.source.ref;
    if (!book || !ref) {
      missing.push(id);
      continue;
    }
    try {
      const blob = await Effect.runPromise(
        runtime.artifacts.getBlob({ ...ref, type: "file/publication", format: ref.mime }),
      );
      if (
        blob.size !== ref.size ||
        (await hashReadableStream(blob.stream(), {
          signal,
          onProgress: (bytes) =>
            report(
              `正在检查 · ${book.title} · ${Math.floor((bytes / Math.max(1, blob.size)) * 100)}%`,
            ),
        })) !== ref.hash
      )
        missing.push(id);
    } catch {
      signal?.throwIfAborted();
      missing.push(id);
    }
  }
  signal?.throwIfAborted();
  return missing;
}
function transferBackupState(ids: ReadonlyArray<string>) {
  const { state } = readerTransferState();
  const selected = new Set(ids);
  return {
    ...state,
    library: state.library.filter((book) => selected.has(book.id)),
    settings: DEFAULT_READER_SETTINGS,
    progressByBook: {},
    bookmarksByBook: {},
    annotationsByBook: {},
    navigationHistory: { back: [], forward: [] },
    searchScope: "library" as const,
    query: "",
    searchBookId: null,
    searchOpen: false,
  };
}
export function planReaderTransfer(ids: ReadonlyArray<string>, limit: number) {
  const state = transferBackupState(ids);
  const entries = state.library.map((book) => {
    const ref = book.source.ref;
    if (!ref) throw new Error(`${book.title} 的源文件不可用`);
    return {
      book: persistBook(book),
      source: { path: `sources/${ref.hash}`, hash: ref.hash, size: ref.size },
    };
  });
  const manifest = readerBackupManifest(state, entries);
  const canonical = new Map(
    decodeReaderBackup(manifest).books.map((entry) => [entry.book.id, entry]),
  );
  const headerBytes = new Blob([JSON.stringify(readerBackupManifest(state, []))]).size;
  const sizes = new Map(
    entries.map((entry) => [entry.book.id, new Blob([JSON.stringify(entry)]).size + 1]),
  );
  const volumes = planReaderBackup(state.library, limit, {
    snapshotSize: (book) => sizes.get(book.id)!,
    snapshotLimit: 64 * 1024 * 1024 - headerBytes,
  });
  if (!volumes.length) volumes.push([]);
  return volumes.map((books) => ({
    books: books.map((book) => {
      const entry = canonical.get(book.id)!;
      return {
        book: book.id,
        target: readerTransferIdentity(entry),
        title: book.title,
        hash: entry.source!.hash,
      };
    }),
    sourceBytes: [
      ...new Map(books.map((book) => [book.source.ref!.hash, book.source.ref!.size])).values(),
    ].reduce((sum, size) => sum + size, 0),
    snapshotBytes: headerBytes + books.reduce((sum, book) => sum + sizes.get(book.id)!, 0),
    readerStamp: readerTransferStamp(books.map((book) => book.id)),
  }));
}

export async function createReaderTransfer(
  ids: ReadonlyArray<string>,
  report: (message: string) => void,
  expectedStamp?: string,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  if (expectedStamp && readerTransferStamp(ids) !== expectedStamp)
    throw new Error("Reader 资料在预览后发生变化，请重新检查资料包");
  const { runtime, state } = readerTransferState();
  const library = state.library.filter((book) => ids.includes(book.id));
  if (library.length !== ids.length || library.some((book) => !book.source.ref))
    throw new Error("部分 Reader 源文件不可用，请重新检查资料包");
  const result = await createReaderBackup(runtime, transferBackupState(ids), report, signal);
  if (expectedStamp && readerTransferStamp(ids) !== expectedStamp)
    throw new Error("Reader 资料在打包期间发生变化，请重试");
  return result;
}
export async function writeReaderTransfer(
  ids: ReadonlyArray<string>,
  destination: WritableStream<Uint8Array>,
  report: (message: string) => void,
  expectedStamp: string,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  if (readerTransferStamp(ids) !== expectedStamp)
    throw new Error("Reader 资料在预览后发生变化，请重新检查资料包");
  const { runtime } = readerTransferState();
  const state = transferBackupState(ids);
  if (state.library.length !== ids.length || state.library.some((book) => !book.source.ref))
    throw new Error("部分 Reader 源文件不可用，请重新检查资料包");
  await writeReaderBackup(runtime, state, destination, report, signal);
  if (readerTransferStamp(ids) !== expectedStamp)
    throw new Error("Reader 资料在打包期间发生变化，请重试");
}
export function readerTransferIdentity(
  entry: PreparedReaderBackup["manifest"]["books"][number],
): string {
  return `research-${textVersion(JSON.stringify(entry))}`;
}
export function readerTransferPreview(prepared: PreparedReaderBackup) {
  const { state } = readerTransferState();
  const reused = prepared.manifest.books.filter((entry) =>
    state.library.some((book) => book.id === readerTransferIdentity(entry)),
  ).length;
  return { added: prepared.manifest.books.length - reused, reused };
}
/** Compare snapshot values, not the property insertion order of different serializers. */
function sectionSnapshotValue(
  sections: PreparedReaderBackup["manifest"]["books"][number]["book"]["sections"],
): string {
  return JSON.stringify(
    sections.map(({ html: _html, ...section }) => section),
    (_key, value: unknown) => {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
      return Object.fromEntries(
        Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
      );
    },
  );
}

/** Publish source books first. Retrying after a collection write failure reuses stable identities. */
export async function restoreReaderTransfer(
  prepared: PreparedReaderBackup,
  report: (message: string) => void,
) {
  const { runtime, state } = readerTransferState();
  const bindings = prepared.manifest.books.map((entry) => ({
    book: entry.book.id,
    target: readerTransferIdentity(entry),
  }));
  const entries = prepared.manifest.books.map((entry, i) => ({
    ...entry,
    book: { ...entry.book, id: bindings[i]!.target },
  }));
  const validate = (current: typeof state) => {
    for (const entry of entries) {
      const existing = current.library.find((book) => book.id === entry.book.id);
      if (!existing && state.library.some((book) => book.id === entry.book.id))
        throw new Error("待复用的 Reader 资料已在恢复期间删除，请重新检查后重试");
      if (
        existing &&
        (existing.source.ref?.hash !== entry.source?.hash ||
          sectionSnapshotValue(persistBook(existing).sections) !==
            sectionSnapshotValue(entry.book.sections))
      ) {
        throw new Error("此前导入的 Reader 资料已修改，请保留或移走该副本后重试");
      }
    }
  };
  validate(state);
  const reused = entries.filter((entry) => state.library.some((book) => book.id === entry.book.id));
  const unavailable = new Set(await checkReaderTransfer(reused.map((entry) => entry.book.id)));
  for (const entry of reused) {
    if (!unavailable.has(entry.book.id)) continue;
    const ref = state.library.find((book) => book.id === entry.book.id)!.source.ref!;
    const blob = entry.source && prepared.sources.get(entry.source.path);
    if (!blob) throw new Error("资料包中的源文件不可用");
    report(`正在修复源文件 · ${entry.book.title}`);
    await Effect.runPromise(
      runtime.artifacts.putStream(
        { ...ref, type: "file/publication", format: ref.mime },
        blob.stream(),
      ),
    );
  }
  const fresh = entries.filter((entry) => !state.library.some((book) => book.id === entry.book.id));
  // Do not deduplicate solely by binary hash: reviewed text snapshots can differ.
  const books = [];
  try {
    for (const entry of fresh)
      books.push(
        ...(await prepareReaderRestore(
          runtime,
          { ...prepared, manifest: { ...prepared.manifest, books: [entry] } },
          [],
          report,
        )),
      );
    const restored = books.map((book) => {
      const snapshot = fresh.find((entry) => entry.book.id === book.id)!.book;
      return {
        ...book,
        preserveSectionSnapshot: true,
        sections: restoreSectionSnapshots(book, snapshot),
        toc: snapshot.toc,
      };
    });
    const added = await commitReaderBooks(runtime, (current) => {
      validate(current);
      return restored.filter((book) => !current.library.some((item) => item.id === book.id));
    });
    const addedIds = new Set(added.map((book) => book.id));
    for (const staged of books) if (!addedIds.has(staged.id)) releaseBookResources(staged);
  } catch (error) {
    for (const book of books) releaseBookResources(book);
    throw error;
  }
  for (const staged of books) {
    const book = getReaderState().library.find((item) => item.id === staged.id);
    if (book) await indexBook(runtime, book);
  }
  return bindings;
}

// Journal recovery reuses staged source files; binary data never enters metadata.
export async function recoverReaderTransfer(
  manifest: PreparedReaderBackup["manifest"],
): Promise<PreparedReaderBackup> {
  const { runtime, state } = readerTransferState();
  const sources = new Map<string, Blob>();
  for (const entry of manifest.books) {
    const source = entry.source;
    if (!source || sources.has(source.path)) continue;
    const existing = state.library.find((book) => book.id === readerTransferIdentity(entry));
    const ref = existing?.source.ref;
    try {
      const blob = await Effect.runPromise(
        runtime.artifacts.getBlob({
          id: ref?.id ?? `reader/${source.hash}`,
          type: "file/publication",
          hash: source.hash,
          storage: ref?.storage ?? (runtime.binary instanceof MemoryStore ? "memory" : "opfs"),
          format: entry.book.source.mime,
        }),
      );
      if (blob.size !== source.size || (await hashReadableStream(blob.stream())) !== source.hash)
        throw new Error("hash");
      sources.set(source.path, blob);
    } catch {
      throw new Error("本地源文件缺失或损坏，请重新选择同一资料包分卷，再确认恢复。");
    }
  }
  return { manifest, sources };
}
export async function flushReaderTransfer() {
  await persistReaderSnapshot(readerTransferState().runtime, {
    durableLibrary: true,
    strict: true,
  });
}
