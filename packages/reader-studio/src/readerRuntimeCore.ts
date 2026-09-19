import { artifactStore, ArtifactStoreTag, type ArtifactStore } from "@bcr/core";
import { isOpfsSupported, MemoryStore, OpfsStore, type BinaryStore } from "@bcr/storage-opfs";
import type { SqliteDb, SqliteModule } from "@bcr/storage-sqlite";
import { Context, Effect, Layer } from "effect";
import type { ReaderParseSession } from "./parse-session";
import { createLazyReaderIndexSession, type ReaderIndexSession } from "./session";
import { acquireProjectLease } from "@bcr/runtime-browser/project-lease";
import { readerStorageLifetime } from "./readerStorage";

export interface ReaderRuntime {
  closing?: boolean;
  disposed?: boolean;
  readonly dispose?: () => Promise<void>;
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
  // Even the localStorage fallback shares durable state between browser tabs.
  const locks = typeof window === "undefined" ? undefined : navigator.locks;
  if (typeof window !== "undefined" && !locks?.request)
    throw new Error("此浏览器不支持安全的书库写入保护，请使用支持 Web Locks 的浏览器。");
  let release: (() => Promise<void>) | undefined;
  try {
    release = locks ? await acquireProjectLease(locks, "reader") : undefined;
  } catch (cause) {
    throw new Error("Reader 已在其他页面打开。请关闭该页面后重试，避免覆盖书库和阅读记录。", {
      cause,
    });
  }
  const storage = readerStorageLifetime(
    isOpfsSupported() ? new OpfsStore("reader") : new MemoryStore(),
  );
  const binary = storage.binary;
  const memory = new MemoryStore();
  let closing: Promise<void> | undefined;
  try {
    const context = await Effect.runPromise(
      Effect.scoped(Layer.build(artifactStore({ memory, opfs: binary }))),
    );
    const artifacts = Context.get(context, ArtifactStoreTag);
    const runtime: ReaderRuntime = {
      dispose: () =>
        (closing ??= (async () => {
          runtime.closing = true;
          runtime.disposed = true;
          runtime.indexSession?.close();
          runtime.parseSession?.close();
          await readerMetadataPromises.get(runtime);
          try {
            await runtime.meta?.close();
          } finally {
            await storage.close();
            if (currentRuntime === runtime) currentRuntime = undefined;
            await release?.();
          }
        })()),
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
  } catch (error) {
    await storage.close();
    await release?.();
    throw error;
  }
}

/** Warm the optional Reader metadata database after the first usable frame. */
export function ensureReaderMetadata(runtime: ReaderRuntime): Promise<void> {
  if (runtime.disposed) return Promise.reject(new Error("Reader 会话已关闭"));
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
