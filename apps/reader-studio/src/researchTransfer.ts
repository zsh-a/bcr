import { Effect } from "effect";
import { textVersion, hashReadableStream } from "@bcr/core";
import {
  createReaderBackup,
  prepareReaderRestore,
  type PreparedReaderBackup,
} from "./readerBackup";
import { readerRuntime } from "./readerRuntimeCore";
import { getReaderState, releaseBookResources } from "./store";
import { persistBook, restoreSectionSnapshots } from "./readerPersistence";
import { commitReaderBooks } from "./readerPersistenceQueue";
import { indexBook } from "./readerSearch";
export { inspectReaderBackup } from "./readerBackup";
export type { PreparedReaderBackup } from "./readerBackup";

export function readerTransferState() {
  const runtime = readerRuntime();
  const state = getReaderState();
  if (!runtime || state.status !== "ready")
    throw new Error("请先打开 Reader，待书库加载完成后再使用完整资料包");
  return { runtime, state };
}
export function readerTransferStamp(ids: ReadonlyArray<string>): string {
  return textVersion(
    JSON.stringify(
      readerTransferState()
        .state.library.filter((book) => ids.includes(book.id))
        .map(persistBook),
    ),
  );
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
  const result = await createReaderBackup(runtime, { ...state, library }, report, signal);
  if (expectedStamp && readerTransferStamp(ids) !== expectedStamp)
    throw new Error("Reader 资料在打包期间发生变化，请重试");
  return result;
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
          JSON.stringify(
            persistBook(existing).sections.map(({ html: _html, ...section }) => section),
          ) !== JSON.stringify(entry.book.sections.map(({ html: _html, ...section }) => section)))
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
