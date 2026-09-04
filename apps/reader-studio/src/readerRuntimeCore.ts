import { artifactStore, ArtifactStoreTag, type ArtifactStore } from "@bcr/core";
import { isOpfsSupported, MemoryStore, OpfsStore, type BinaryStore } from "@bcr/storage-opfs";
import type { SqliteDb, SqliteModule } from "@bcr/storage-sqlite";
import { Context, Effect, Layer } from "effect";
import type { ReaderParseSession } from "./parse-session";
import { createLazyReaderIndexSession, type ReaderIndexSession } from "./session";

export interface ReaderRuntime {
  readonly binary: BinaryStore;
  readonly artifacts: ArtifactStore;
  meta: SqliteDb | undefined;
  ftsReady: boolean;
  indexSession: ReaderIndexSession | undefined;
  parseSession: ReaderParseSession | undefined;
  parserMode: "worker" | "main";
}

interface SqliteInit {
  (options?: { locateFile?: (file: string) => string }): Promise<SqliteModule>;
}

const FTS_SCHEMA = `
CREATE VIRTUAL TABLE IF NOT EXISTS reader_fts USING fts5(
  book_id UNINDEXED,
  section_id UNINDEXED,
  label,
  body,
  tokenize='trigram'
);`;

let currentRuntime: ReaderRuntime | undefined;
const readerMetadataPromises = new WeakMap<ReaderRuntime, Promise<void>>();

async function openMetaDb(store: BinaryStore): Promise<SqliteDb> {
  const [{ default: initSqlite }, { default: wasmUrl }, { openSqliteDb }] = await Promise.all([
    import("@sqlite.org/sqlite-wasm"),
    import("@sqlite.org/sqlite-wasm/sqlite3.wasm?url"),
    import("@bcr/storage-sqlite"),
  ]);
  const init = initSqlite as unknown as SqliteInit;
  const sqlite3 = await init({ locateFile: () => wasmUrl });
  return openSqliteDb({ store, path: "reader/meta.db", sqlite3 });
}

export async function createReaderRuntime(): Promise<ReaderRuntime> {
  const binary = isOpfsSupported() ? new OpfsStore("reader") : new MemoryStore();
  const memory = new MemoryStore();
  const context = await Effect.runPromise(
    Effect.scoped(Layer.build(artifactStore({ memory, opfs: binary }))),
  );
  const artifacts = Context.get(context, ArtifactStoreTag);
  const runtime: ReaderRuntime = {
    binary,
    artifacts,
    // SQLite and both Reader workers are enhanced capabilities. Deferring
    // them lets the installed PWA paint the first page before storage/index
    // infrastructure starts competing for mobile CPU and I/O.
    meta: undefined,
    ftsReady: false,
    indexSession: createLazyReaderIndexSession(artifacts),
    parseSession: undefined,
    parserMode: "main",
  };
  currentRuntime = runtime;
  return runtime;
}

/** Warm the optional Reader metadata database after the first usable frame. */
export function ensureReaderMetadata(runtime: ReaderRuntime): Promise<void> {
  if (runtime.meta !== undefined) return Promise.resolve();
  const pending = readerMetadataPromises.get(runtime);
  if (pending !== undefined) return pending;
  const next = openMetaDb(runtime.binary)
    .then((meta) => {
      runtime.meta = meta;
      try {
        meta.run(FTS_SCHEMA);
        runtime.ftsReady = true;
      } catch {
        // Older sqlite builds can lack FTS5. JS/worker search remains available.
      }
    })
    .catch(() => {
      // Metadata is an enhancement; localStorage and worker search remain durable.
    });
  readerMetadataPromises.set(runtime, next);
  return next;
}

export function readerRuntime(): ReaderRuntime | undefined {
  return currentRuntime;
}
