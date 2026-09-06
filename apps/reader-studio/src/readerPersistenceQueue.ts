import type { ReaderBook } from "@bcr/reader-core";
import type { ReaderState } from "./model";
import { ensureReaderMetadata, readerRuntime, type ReaderRuntime } from "./readerRuntimeCore";
import {
  mirrorReaderLibrary,
  mirrorReaderSession,
  persistReader,
  restoreReader,
} from "./readerPersistence";
import { getReaderState, reader } from "./store";

// All Reader runtimes use the same durable namespace. Queue operations, not
// captured snapshots, so a delayed save always reads the latest live state.
let tail: Promise<unknown> = Promise.resolve();
function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const pending = tail.catch(() => undefined).then(work);
  tail = pending.catch(() => undefined);
  return pending;
}

/** Startup/warmup must not observe a catalog before a pending commit finishes. */
export function restoreReaderSnapshot(runtime: ReaderRuntime) {
  return enqueue(async () => {
    if (readerRuntime() !== runtime) throw new Error("Reader 会话已切换");
    return restoreReader(runtime, { deferBinary: true });
  });
}

class SnapshotChanged extends Error {}
function assertSnapshot(runtime: ReaderRuntime, snapshot: ReaderState): void {
  if (readerRuntime() !== runtime || getReaderState().status !== "ready")
    throw new Error("Reader 会话已切换，请重新打开资料包后重试");
  const latest = getReaderState();
  const fields = [
    "library",
    "progressByBook",
    "settings",
    "bookmarksByBook",
    "annotationsByBook",
    "navigationHistory",
    "activeBookId",
    "query",
    "searchBookId",
    "searchOpen",
    "searchScope",
  ] as const;
  if (fields.some((field) => latest[field] !== snapshot[field])) throw new SnapshotChanged();
}

/** Caller holds the queue. Retry a stale write before any later operation can run. */
async function saveCurrent(runtime: ReaderRuntime, forceLibrary = false): Promise<void> {
  for (;;) {
    const snapshot = getReaderState();
    try {
      await persistReader(runtime, snapshot, {
        forceLibrary,
        assertCurrent: () => assertSnapshot(runtime, snapshot),
      });
      assertSnapshot(runtime, snapshot);
      return;
    } catch (error) {
      if (!(error instanceof SnapshotChanged)) throw error;
      // A concurrent pagehide mirror may already have replaced localStorage.
      // Do not trust the cache of the interrupted writer on the retry.
      forceLibrary = true;
    }
  }
}

export function persistReaderSnapshot(
  runtime: ReaderRuntime,
  options: { readonly durableLibrary?: boolean; readonly strict?: boolean } = {},
): Promise<void> {
  const state = getReaderState();
  if (state.status !== "ready" || readerRuntime() !== runtime) return Promise.resolve();
  mirrorReaderSession(state);
  mirrorReaderLibrary(runtime, state);
  const pending = enqueue(async () => {
    if (readerRuntime() !== runtime) return;
    if (options.durableLibrary) await ensureReaderMetadata(runtime);
    await saveCurrent(runtime);
    reader.markSaved();
  });
  const handled = pending.catch((error: unknown) => {
    if (readerRuntime() === runtime) reader.markSaveFailed(error);
  });
  return options.strict ? pending : handled;
}

/** Stage outside the queue, then validate/merge against live state on every attempt. */
export function commitReaderBooks(
  runtime: ReaderRuntime,
  select: (state: ReaderState) => ReadonlyArray<ReaderBook>,
): Promise<ReadonlyArray<ReaderBook>> {
  return enqueue(async () => {
    let attempted = false;
    try {
      for (;;) {
        const snapshot = getReaderState();
        assertSnapshot(runtime, snapshot);
        const added = select(snapshot);
        if (!added.length && !attempted) return added;
        const next = added.length
          ? { ...snapshot, library: [...snapshot.library, ...added] }
          : snapshot;
        attempted = true;
        try {
          await persistReader(runtime, next, {
            forceLibrary: true,
            assertCurrent: () => assertSnapshot(runtime, snapshot),
          });
          assertSnapshot(runtime, snapshot);
        } catch (error) {
          if (error instanceof SnapshotChanged) continue;
          throw error;
        }
        reader.appendRestoredBooks(added);
        reader.markSaved();
        return added;
      }
    } catch (error) {
      // Writes span library/session keys. Remove any provisional additions
      // from durable state before letting queued autosaves or retries proceed.
      if (attempted && readerRuntime() === runtime) {
        try {
          await saveCurrent(runtime, true);
        } catch (repairError) {
          const failure = new Error(
            `恢复尚未提交，当前书库重新保存也失败，请重试：${String(repairError)}`,
            { cause: error },
          );
          reader.markSaveFailed(failure);
          throw failure;
        }
      }
      if (readerRuntime() === runtime) reader.markSaveFailed(error);
      throw error;
    }
  });
}
