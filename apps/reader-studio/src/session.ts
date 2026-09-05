import type { ArtifactRef, ArtifactStore, ComputeTask, TaskEvent } from "@bcr/core";
import {
  searchIndexedDocuments,
  type ReaderBook,
  type ReaderIndexDocument,
  type SearchHit,
} from "@bcr/reader-core";
import { workerExecutor, WorkerPool } from "@bcr/runtime-worker";
import { Effect, Stream } from "effect";

interface ReaderIndexResult {
  readonly version: 1;
  readonly bookId: string;
  readonly signature: string;
  readonly documents: ReadonlyArray<ReaderIndexDocument>;
}

export interface ReaderIndexSearch {
  readonly hits: ReadonlyArray<SearchHit>;
  readonly indexedBookIds: ReadonlyArray<string>;
  readonly pendingBookIds: ReadonlyArray<string>;
}

export interface ReaderIndexSession {
  readonly indexBook: (book: ReaderBook, signal?: AbortSignal) => Promise<void>;
  readonly removeBook: (bookId: string) => void;
  readonly subscribe: (listener: () => void) => () => void;
  /** Returns available worker hits plus the books still using the fallback path. */
  readonly search: (
    books: ReadonlyArray<ReaderBook>,
    query: string,
  ) => ReaderIndexSearch | undefined;
  readonly close: () => void;
}

let taskSequence = 0;
const INDEX_ALGORITHM_VERSION = "reader-search-v2";

function isReaderIndexResult(value: unknown): value is ReaderIndexResult {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as {
    version?: unknown;
    bookId?: unknown;
    signature?: unknown;
    documents?: unknown;
  };
  return (
    candidate.version === 1 &&
    typeof candidate.bookId === "string" &&
    typeof candidate.signature === "string" &&
    Array.isArray(candidate.documents)
  );
}

function indexSignature(book: ReaderBook): string {
  const sourceSignature =
    book.source.ref?.hash ??
    [
      book.id,
      book.updatedAt,
      book.sections.length,
      ...book.sections.map((section) => `${section.id}:${section.text.length}`),
    ]
      .join("|")
      .replace(/[^a-zA-Z0-9._|-]/gu, "_");
  return `${INDEX_ALGORITHM_VERSION}:${sourceSignature}`;
}

function indexCacheRef(book: ReaderBook, signature: string): ArtifactRef {
  return {
    id: `reader/search-index/${encodeURIComponent(book.id)}/${signature}`,
    type: "reader/search-index",
    storage: "opfs",
    format: "json",
    hash: signature,
  };
}

function abortError(): DOMException {
  return new DOMException("Aborted", "AbortError");
}

function awaitWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (reason: unknown) => {
        cleanup();
        reject(reason);
      },
    );
  });
}

export function createReaderIndexSession(artifacts: ArtifactStore): ReaderIndexSession | undefined {
  if (typeof Worker === "undefined" || typeof MessageChannel === "undefined") return undefined;

  const pool = new WorkerPool(
    {
      minSize: 1,
      maxSize: Math.max(1, (navigator.hardwareConcurrency ?? 2) - 1),
      idleTimeoutMs: 30_000,
    },
    () =>
      new Worker(new URL("./workers/reader-index.worker.ts", import.meta.url), {
        type: "module",
      }),
  );
  const executor = workerExecutor(pool, "js", "reader-index-0.1.0", artifacts, ["reader.index"]);
  const indexed = new Map<
    string,
    { readonly signature: string; readonly documents: ReadonlyArray<ReaderIndexDocument> }
  >();
  const pending = new Map<string, Promise<void>>();
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  return {
    async indexBook(book, signal) {
      if (signal?.aborted) throw abortError();
      const signature = indexSignature(book);
      const cached = indexed.get(book.id);
      if (cached?.signature === signature) return;
      const inFlight = pending.get(book.id);
      if (inFlight !== undefined) return awaitWithAbort(inFlight, signal);
      if (cached !== undefined) indexed.delete(book.id);
      const job = (async () => {
        const cacheRef = indexCacheRef(book, signature);
        try {
          if (await Effect.runPromise(artifacts.has(cacheRef))) {
            const bytes = await Effect.runPromise(artifacts.get(cacheRef));
            const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
            if (
              isReaderIndexResult(parsed) &&
              parsed.bookId === book.id &&
              parsed.signature === signature
            ) {
              indexed.set(book.id, { signature, documents: parsed.documents });
              return;
            }
          }
        } catch {
          // A stale or unavailable cache is equivalent to a cache miss.
        }
        const task: ComputeTask = {
          id: `reader-index-${++taskSequence}`,
          runtime: "js",
          operation: "reader.index",
          inputs: [],
          outputs: [
            {
              name: "index",
              type: "reader/search-index",
              storage: "memory",
              format: "json",
            },
          ],
          config: {
            book: {
              id: book.id,
              sections: book.sections.map((section) => ({
                id: section.id,
                label: section.label,
                text: section.text,
              })),
            },
            signature,
          },
        };
        const events = await Effect.runPromise(
          Stream.runCollect(executor.run(task)),
          signal === undefined ? undefined : { signal },
        );
        const completed = [...events].find(
          (event: TaskEvent): event is Extract<TaskEvent, { type: "completed" }> =>
            event.type === "completed",
        );
        const ref = completed?.outputs[0];
        if (ref === undefined) throw new Error("reader index worker returned no output");
        const bytes = await Effect.runPromise(artifacts.get(ref));
        const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
        if (
          !isReaderIndexResult(parsed) ||
          parsed.bookId !== book.id ||
          parsed.signature !== signature
        ) {
          throw new Error("reader index output is invalid");
        }
        await Effect.runPromise(
          artifacts.put(cacheRef, new TextEncoder().encode(JSON.stringify(parsed))),
        );
        indexed.set(book.id, { signature, documents: parsed.documents });
      })();
      pending.set(book.id, job);
      try {
        await job;
      } catch (reason) {
        if (signal?.aborted) throw abortError();
        throw reason;
      } finally {
        if (pending.get(book.id) === job) pending.delete(book.id);
        notify();
      }
    },
    removeBook(bookId) {
      indexed.delete(bookId);
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    search(books, query) {
      const indexedBooks = books.filter((book) => indexed.has(book.id));
      const documents = indexedBooks.flatMap((book) => indexed.get(book.id)?.documents ?? []);
      return {
        hits: searchIndexedDocuments(documents, indexedBooks, query),
        indexedBookIds: indexedBooks.map((book) => book.id),
        pendingBookIds: books.filter((book) => pending.has(book.id)).map((book) => book.id),
      };
    },
    close() {
      pool.shutdown();
      indexed.clear();
      pending.clear();
      listeners.clear();
    },
  };
}

/**
 * Keeps the Reader search contract available without spawning its WorkerPool
 * during the first paint. The actual index session is created by the first
 * indexing operation and all early subscribers are forwarded to it.
 */
export function createLazyReaderIndexSession(artifacts: ArtifactStore): ReaderIndexSession {
  let session: ReaderIndexSession | undefined;
  const listeners = new Set<() => void>();
  const subscriptions = new Map<() => void, () => void>();

  const ensure = (): ReaderIndexSession | undefined => {
    if (session !== undefined) return session;
    session = createReaderIndexSession(artifacts);
    if (session !== undefined) {
      for (const listener of listeners) {
        subscriptions.set(listener, session.subscribe(listener));
      }
    }
    return session;
  };

  return {
    indexBook: async (book, signal) => {
      const next = ensure();
      if (next === undefined) return;
      await next.indexBook(book, signal);
    },
    removeBook: (bookId) => {
      session?.removeBook(bookId);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      if (session !== undefined) subscriptions.set(listener, session.subscribe(listener));
      return () => {
        listeners.delete(listener);
        subscriptions.get(listener)?.();
        subscriptions.delete(listener);
      };
    },
    search: (books, query) => session?.search(books, query),
    close: () => {
      for (const unsubscribe of subscriptions.values()) unsubscribe();
      subscriptions.clear();
      session?.close();
      session = undefined;
      listeners.clear();
    },
  };
}
