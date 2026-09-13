import { searchReaderDetailed } from "./readerSearch";
import type { ReaderBook } from "@bcr/reader-core";
import { useCallback, useEffect, useState } from "react";
import {
  createReaderRuntime,
  ensureReaderMetadata,
  indexBook,
  restoreReaderBooks,
  type ReaderRestoreDiagnostics,
  type ReaderRuntime,
} from "./runtime";
import { getReaderState, reader, useReader } from "./store";

export const READER_CAPTURE_PROGRESS_EVENT = "bcr-reader-capture-progress";

export { persistReaderSnapshot } from "./readerPersistenceQueue";
import { persistReaderSnapshot, restoreReaderSnapshot } from "./readerPersistenceQueue";

export function captureReaderProgress(): void {
  window.dispatchEvent(new Event(READER_CAPTURE_PROGRESS_EVENT));
}

export interface ReaderPwaUpdateState {
  readonly visible: boolean;
  readonly applying: boolean;
  readonly apply: () => Promise<void>;
  readonly dismiss: () => void;
}

function pendingReaderPwaUpdate(): boolean {
  if (typeof window === "undefined") return false;
  return (
    (window as Window & { readonly __bcrReaderUpdateReady?: boolean }).__bcrReaderUpdateReady ===
    true
  );
}

export function useReaderPwaUpdate(runtime: ReaderRuntime | null): ReaderPwaUpdateState {
  const [ready, setReady] = useState(pendingReaderPwaUpdate);
  const [dismissed, setDismissed] = useState(false);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    const onUpdateReady = () => {
      setReady(true);
      setDismissed(false);
    };
    window.addEventListener("bcr-reader-update-ready", onUpdateReady);
    return () => window.removeEventListener("bcr-reader-update-ready", onUpdateReady);
  }, []);

  const apply = useCallback(async () => {
    if (runtime === null || applying) return;
    setApplying(true);
    // Mirror state synchronously, then wait for the durable SQLite/OPFS queue
    // before allowing the new worker to take control and reload the Reader.
    captureReaderProgress();
    await persistReaderSnapshot(runtime, { durableLibrary: true });
    window.dispatchEvent(new Event("bcr-reader-apply-update"));
  }, [applying, runtime]);

  return {
    visible: ready && !dismissed,
    applying,
    apply,
    dismiss: () => setDismissed(true),
  };
}

export function isAbortError(reason: unknown): boolean {
  return (
    (reason instanceof DOMException && reason.name === "AbortError") ||
    (reason instanceof Error && reason.name === "AbortError")
  );
}

export function useDebouncedPersist(runtime: ReaderRuntime | null): void {
  const library = useReader((state) => state.library);
  const progressByBook = useReader((state) => state.progressByBook);
  const bookmarksByBook = useReader((state) => state.bookmarksByBook);
  const annotationsByBook = useReader((state) => state.annotationsByBook);
  const query = useReader((state) => state.query);
  const searchBookId = useReader((state) => state.searchBookId);
  const searchOpen = useReader((state) => state.searchOpen);
  const settings = useReader((state) => state.settings);
  const navigationHistory = useReader((state) => state.navigationHistory);
  const searchScope = useReader((state) => state.searchScope);
  useEffect(() => {
    if (runtime === null || getReaderState().status !== "ready") return;
    const handle = window.setTimeout(() => {
      void persistReaderSnapshot(runtime);
    }, 900);
    return () => window.clearTimeout(handle);
  }, [
    runtime,
    library,
    progressByBook,
    bookmarksByBook,
    annotationsByBook,
    query,
    searchBookId,
    searchOpen,
    settings,
    navigationHistory,
    searchScope,
  ]);

  useEffect(() => {
    if (runtime === null) return;
    const flush = () => {
      captureReaderProgress();
      void persistReaderSnapshot(runtime);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [runtime]);
}

export function useReaderSearch(runtime: ReaderRuntime | null): void {
  const query = useReader((state) => state.query);
  const scope = useReader((state) => state.searchScope);
  const activeId = useReader((state) => (state.searchScope === "book" ? state.activeBookId : null));
  const library = useReader((state) => state.library);
  const [indexRevision, setIndexRevision] = useState(0);
  useEffect(() => {
    const unsubscribe = runtime?.indexSession?.subscribe(() => {
      setIndexRevision((revision) => revision + 1);
    });
    return unsubscribe;
  }, [runtime]);
  useEffect(() => {
    if (runtime === null) return;
    const controller = new AbortController();
    const handle = window.setTimeout(async () => {
      if (query.trim() === "") {
        reader.setSearch(query, [], null);
        reader.setSearchBusy(false);
        return;
      }
      reader.setSearchBusy(true);
      try {
        const result = await searchReaderDetailed(
          runtime,
          scope === "book" ? library.filter((book) => book.id === activeId) : library,
          query,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        reader.setSearch(query, result.hits, getReaderState().searchBookId);
        reader.setSearchBusy(result.indexing);
      } catch {
        if (controller.signal.aborted) return;
        reader.setSearch(query, [], null);
        reader.setSearchBusy(false);
      }
    }, 160);
    return () => {
      controller.abort();
      window.clearTimeout(handle);
    };
  }, [indexRevision, runtime, query, library, scope, activeId]);
}

export interface ReaderBootState {
  readonly runtime: ReaderRuntime | null;
  readonly error: string | null;
  readonly recovery: ReaderRestoreDiagnostics | null;
}

export function useReaderBoot(): ReaderBootState {
  const [runtime, setRuntime] = useState<ReaderRuntime | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<ReaderRestoreDiagnostics | null>(null);
  useEffect(() => {
    let cancelled = false;
    let createdRuntime: ReaderRuntime | null = null;
    let metadataWarmupTimer: number | undefined;
    let indexingTimer: number | undefined;
    let binaryRestoreTimer: number | undefined;
    const binaryRestoreController = new AbortController();
    const pendingBinaryBooks = new Set<string>();
    let restoringBinary = false;
    const scheduleIndexing = (
      nextRuntime: ReaderRuntime,
      books: ReadonlyArray<ReaderBook>,
    ): void => {
      if (books.length === 0) return;
      indexingTimer = window.setTimeout(() => {
        if (!cancelled) void Promise.all(books.map((book) => indexBook(nextRuntime, book)));
      }, 1200);
    };
    const restoreActiveBook = () => {
      const nextRuntime = createdRuntime;
      const id = getReaderState().activeBookId;
      if (
        cancelled ||
        restoringBinary ||
        nextRuntime === null ||
        id === null ||
        !pendingBinaryBooks.delete(id)
      )
        return;
      restoringBinary = true;
      void restoreReaderBooks(nextRuntime, [id], binaryRestoreController.signal, (book) => {
        if (!cancelled) reader.replaceBook(book);
      })
        .then(({ issues }) => {
          if (cancelled) return;
          if (issues.length > 0) {
            setRecovery((previous) =>
              previous === null
                ? previous
                : {
                    ...previous,
                    restoredBooks: Math.max(0, previous.restoredBooks - issues.length),
                    skippedBooks: [...previous.skippedBooks, ...issues],
                  },
            );
          }
        })
        .catch(() => {
          // The cached projection remains readable when a source cannot be
          // rehydrated in the background.
        })
        .finally(() => {
          restoringBinary = false;
          restoreActiveBook();
        });
    };
    const unsubscribeRestore = reader.subscribe(restoreActiveBook);
    const scheduleBinaryRestore = (bookIds: ReadonlyArray<string>): void => {
      for (const id of bookIds) pendingBinaryBooks.add(id);
      if (binaryRestoreTimer !== undefined) window.clearTimeout(binaryRestoreTimer);
      binaryRestoreTimer = window.setTimeout(restoreActiveBook, 0);
    };
    const scheduleMetadataWarmup = (nextRuntime: ReaderRuntime): void => {
      const baselineLibrary = getReaderState().library;
      const baselineLibraryIds = baselineLibrary.map((book) => book.id).join("\u0000");
      const baselineActiveBookId = getReaderState().activeBookId;
      metadataWarmupTimer = window.setTimeout(() => {
        void ensureReaderMetadata(nextRuntime)
          .then(() => restoreReaderSnapshot(nextRuntime))
          .then((durable) => {
            if (cancelled || durable === undefined) return;
            const current = getReaderState();
            if (current.library.map((book) => book.id).join("\u0000") !== baselineLibraryIds) {
              return;
            }
            const recovered = reader.reconcileLibrary(
              durable.books,
              durable.progressByBook,
              durable.bookmarksByBook,
              durable.activeBookId,
              durable.annotationsByBook,
              current.activeBookId === baselineActiveBookId,
            );
            if (recovered.length === 0) return;
            const recoveredIds = new Set(recovered.map((book) => book.id));
            setRecovery(durable.recovery);
            void Promise.all(recovered.map((book) => indexBook(nextRuntime, book)));
            scheduleBinaryRestore(
              durable.pendingBookIds.filter((bookId) => recoveredIds.has(bookId)),
            );
            void persistReaderSnapshot(nextRuntime, { durableLibrary: true });
          })
          .catch(() => {
            // The fast local projection stays usable when metadata recovery fails.
          });
      }, 1200);
    };
    void createReaderRuntime()
      .then(async (nextRuntime) => {
        createdRuntime = nextRuntime;
        if (cancelled) {
          nextRuntime.indexSession?.close();
          nextRuntime.parseSession?.close();
          return;
        }
        setRuntime(nextRuntime);
        let restored = await restoreReaderSnapshot(nextRuntime);
        if (restored?.libraryOutdated === true) {
          // A compact session is much more likely to fit in localStorage than
          // a full novel. Open SQLite only when its library signature proves
          // that the fast local projection is stale or incomplete.
          await ensureReaderMetadata(nextRuntime);
          const durable = await restoreReaderSnapshot(nextRuntime);
          if (durable !== undefined && !durable.libraryOutdated) restored = durable;
        }
        if (cancelled) return;
        if (restored !== undefined) {
          setRecovery(restored.recovery);
          reader.hydrate(
            restored.books,
            restored.progressByBook,
            restored.settings,
            restored.bookmarksByBook,
            restored.activeBookId,
            restored.annotationsByBook,
            restored.searchSession,
            restored.navigationHistory,
          );
          scheduleMetadataWarmup(nextRuntime);
          scheduleIndexing(nextRuntime, restored.books);
          scheduleBinaryRestore(restored.pendingBookIds);
        } else {
          setRecovery(null);
          reader.setReady();
          scheduleMetadataWarmup(nextRuntime);
          scheduleIndexing(nextRuntime, [getReaderState().library[0]!]);
        }
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        const message = reason instanceof Error ? reason.message : String(reason);
        setError(message);
        reader.setError(reason);
      });
    return () => {
      cancelled = true;
      if (metadataWarmupTimer !== undefined) window.clearTimeout(metadataWarmupTimer);
      if (indexingTimer !== undefined) window.clearTimeout(indexingTimer);
      if (binaryRestoreTimer !== undefined) window.clearTimeout(binaryRestoreTimer);
      binaryRestoreController.abort();
      unsubscribeRestore();
      createdRuntime?.indexSession?.close();
      createdRuntime?.parseSession?.close();
    };
  }, []);
  return { runtime, error, recovery };
}
