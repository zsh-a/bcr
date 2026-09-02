import type { ArtifactStore, ComputeTask, TaskEvent } from "@bcr/core";
import {
  searchIndexedDocuments,
  type ReaderBook,
  type ReaderIndexDocument,
  type SearchHit,
} from "@bcr/reader-core";
import { Effect, Stream } from "effect";
import { workerExecutor, WorkerPool } from "@bcr/runtime-worker";

interface ReaderIndexResult {
  readonly version: 1;
  readonly bookId: string;
  readonly documents: ReadonlyArray<ReaderIndexDocument>;
}

export interface ReaderIndexSession {
  readonly indexBook: (book: ReaderBook, signal?: AbortSignal) => Promise<void>;
  readonly removeBook: (bookId: string) => void;
  /** undefined means at least one book is still being indexed. */
  readonly search: (
    books: ReadonlyArray<ReaderBook>,
    query: string,
  ) => ReadonlyArray<SearchHit> | undefined;
  readonly close: () => void;
}

let taskSequence = 0;

function isReaderIndexResult(value: unknown): value is ReaderIndexResult {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { version?: unknown; bookId?: unknown; documents?: unknown };
  return (
    candidate.version === 1 &&
    typeof candidate.bookId === "string" &&
    Array.isArray(candidate.documents)
  );
}

function abortError(): DOMException {
  return new DOMException("Aborted", "AbortError");
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
  const executor = workerExecutor(pool, "js", "reader-index-0.1.0", artifacts);
  const indexed = new Map<string, ReadonlyArray<ReaderIndexDocument>>();

  return {
    async indexBook(book, signal) {
      if (signal?.aborted) throw abortError();
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
        },
      };
      try {
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
        if (!isReaderIndexResult(parsed) || parsed.bookId !== book.id) {
          throw new Error("reader index output is invalid");
        }
        indexed.set(book.id, parsed.documents);
      } catch (reason) {
        if (signal?.aborted) throw abortError();
        throw reason;
      }
    },
    removeBook(bookId) {
      indexed.delete(bookId);
    },
    search(books, query) {
      if (books.some((book) => !indexed.has(book.id))) return undefined;
      const documents = books.flatMap((book) => indexed.get(book.id) ?? []);
      return searchIndexedDocuments(documents, books, query);
    },
    close() {
      pool.shutdown();
      indexed.clear();
    },
  };
}
