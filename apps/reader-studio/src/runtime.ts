import {
  artifactPath,
  artifactStore,
  ArtifactStoreTag,
  hashReadableStream,
  type ArtifactRef,
  type ArtifactStore,
} from "@bcr/core";
import { isOpfsSupported, MemoryStore, OpfsStore, type BinaryStore } from "@bcr/storage-opfs";
import { openSqliteDb, type SqliteDb } from "@bcr/storage-sqlite";
import initSqlite from "@sqlite.org/sqlite-wasm";
import wasmUrl from "@sqlite.org/sqlite-wasm/sqlite3.wasm?url";
import { Context, Effect, Layer } from "effect";
import {
  normalizeAnnotation,
  normalizeBookmark,
  normalizeLocator,
  normalizeSearchQuery,
  searchLibrary,
  type ReaderBook,
  type ReaderAnnotation,
  type ReaderBookmark,
  type SearchHit,
} from "@bcr/reader-core";
import { formatForFile, openReaderFile } from "./adapters";
import {
  DEFAULT_READER_SETTINGS,
  type ReaderSearchSession,
  type ReaderSettings,
  type ReaderState,
} from "./model";
import { createReaderIndexSession, type ReaderIndexSession } from "./session";

export interface ReaderRuntime {
  readonly binary: BinaryStore;
  readonly artifacts: ArtifactStore;
  readonly meta: SqliteDb | undefined;
  readonly ftsReady: boolean;
  readonly indexSession: ReaderIndexSession | undefined;
}

interface SqliteInit {
  (options?: {
    locateFile?: (file: string) => string;
  }): Promise<Parameters<typeof openSqliteDb>[0]["sqlite3"]>;
}

interface PersistedBook {
  readonly id: string;
  readonly title: string;
  readonly author?: string | undefined;
  readonly language?: string | undefined;
  readonly source: {
    readonly name: string;
    readonly format: ReaderBook["source"]["format"];
    readonly mime: string;
    readonly size: number;
    readonly ref?: ReaderBook["source"]["ref"] | undefined;
  };
  readonly sections: ReadonlyArray<{
    readonly id: string;
    readonly order: number;
    readonly label: string;
    readonly kind: ReaderBook["sections"][number]["kind"];
    readonly text: string;
    readonly html?: string | undefined;
    readonly pageNumber?: number | undefined;
    readonly href?: string | undefined;
    readonly imageAlt?: string | undefined;
  }>;
  readonly importedAt: number;
  readonly updatedAt: number;
  readonly tags: ReadonlyArray<string>;
}

interface PersistedReaderSnapshot {
  readonly version: 1;
  readonly books: ReadonlyArray<PersistedBook>;
  readonly activeBookId?: string | null;
  readonly progressByBook: ReaderState["progressByBook"];
  readonly settings: ReaderSettings;
  readonly bookmarksByBook?: ReaderState["bookmarksByBook"];
  readonly annotationsByBook?: ReaderState["annotationsByBook"];
  readonly searchSession?: ReaderSearchSession;
}

interface PersistedReaderLibrary {
  readonly version: 1;
  readonly books: ReadonlyArray<PersistedBook>;
}

interface PersistedReaderSession {
  readonly version: 1;
  readonly activeBookId?: string | null;
  readonly progressByBook?: ReaderState["progressByBook"];
  readonly settings?: ReaderSettings;
  readonly bookmarksByBook?: ReaderState["bookmarksByBook"];
  readonly annotationsByBook?: ReaderState["annotationsByBook"];
  readonly searchSession?: ReaderSearchSession;
}

interface RestoredReaderSnapshot {
  readonly books: ReadonlyArray<ReaderBook>;
  readonly activeBookId: string | null;
  readonly progressByBook: ReaderState["progressByBook"];
  readonly settings: ReaderSettings;
  readonly bookmarksByBook: ReaderState["bookmarksByBook"];
  readonly annotationsByBook: ReaderState["annotationsByBook"];
  readonly searchSession: ReaderSearchSession;
}

const FTS_SCHEMA = `
CREATE VIRTUAL TABLE IF NOT EXISTS reader_fts USING fts5(
  book_id UNINDEXED,
  section_id UNINDEXED,
  label,
  body,
  tokenize='trigram'
);`;

const READER_STORAGE_KEY = "bcr.reader.state.v1";
const READER_LIBRARY_STORAGE_KEY = "bcr.reader.library.v1";
const READER_SESSION_STORAGE_KEY = "bcr.reader.session.v1";
const READER_META_KEY = "reader/state";
const READER_LIBRARY_META_KEY = "reader/library";
const READER_SESSION_META_KEY = "reader/session";

let currentRuntime: ReaderRuntime | undefined;
const persistedLibrarySignatures = new WeakMap<ReaderRuntime, string>();

async function openMetaDb(store: BinaryStore): Promise<SqliteDb> {
  const init = initSqlite as unknown as SqliteInit;
  const sqlite3 = await init({ locateFile: () => wasmUrl });
  return openSqliteDb({ store, path: "reader/meta.db", sqlite3 });
}

export async function createReaderRuntime(): Promise<ReaderRuntime> {
  const binary = isOpfsSupported() ? new OpfsStore("reader") : new MemoryStore();
  const memory = new MemoryStore();
  let meta: SqliteDb | undefined;
  let ftsReady = false;
  try {
    meta = await openMetaDb(binary);
    try {
      meta.run(FTS_SCHEMA);
      ftsReady = true;
    } catch {
      // Older sqlite builds can lack FTS5. The reader keeps a deterministic
      // in-memory fallback so search remains available instead of blocking boot.
    }
  } catch {
    meta = undefined;
  }
  const context = await Effect.runPromise(
    Effect.scoped(Layer.build(artifactStore({ memory, opfs: binary }))),
  );
  const artifacts = Context.get(context, ArtifactStoreTag);
  const runtime: ReaderRuntime = {
    binary,
    artifacts,
    meta,
    ftsReady,
    indexSession: createReaderIndexSession(artifacts),
  };
  currentRuntime = runtime;
  return runtime;
}

export function readerRuntime(): ReaderRuntime | undefined {
  return currentRuntime;
}

export async function importReaderFile(
  runtime: ReaderRuntime,
  file: File,
  signal?: AbortSignal,
): Promise<ReaderBook> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const hash = await hashReadableStream(file.stream());
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const format = formatForFile(file);
  const storage: ArtifactRef["storage"] = runtime.binary instanceof MemoryStore ? "memory" : "opfs";
  const ref: ArtifactRef = {
    id: `reader/${hash}`,
    type: "file/publication",
    storage,
    format: file.type || format,
    hash,
  };
  await Effect.runPromise(runtime.artifacts.putStream(ref, file.stream()));
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const book = await openReaderFile(file, `book-${hash.slice(0, 16)}`, signal);
  return {
    ...book,
    source: {
      ...book.source,
      ref: {
        id: ref.id,
        hash,
        storage: storage === "memory" ? "memory" : "opfs",
        mime: file.type || book.source.mime,
        size: file.size,
      },
    },
  };
}

function persistBook(book: ReaderBook): PersistedBook {
  return {
    id: book.id,
    title: book.title,
    ...(book.author === undefined ? {} : { author: book.author }),
    ...(book.language === undefined ? {} : { language: book.language }),
    source: {
      name: book.source.name,
      format: book.source.format,
      mime: book.source.mime,
      size: book.source.size,
      ...(book.source.ref === undefined ? {} : { ref: book.source.ref }),
    },
    sections: book.sections.map((section) => ({
      id: section.id,
      order: section.order,
      label: section.label,
      kind: section.kind,
      text: section.text,
      ...(section.html === undefined ? {} : { html: section.html }),
      ...(section.pageNumber === undefined ? {} : { pageNumber: section.pageNumber }),
      ...(section.href === undefined ? {} : { href: section.href }),
      ...(section.imageAlt === undefined ? {} : { imageAlt: section.imageAlt }),
    })),
    importedAt: book.importedAt,
    updatedAt: book.updatedAt,
    tags: book.tags,
  };
}

export async function persistReader(runtime: ReaderRuntime, state: ReaderState): Promise<void> {
  const books = state.library.map(persistBook);
  const librarySignature = state.library
    .map(
      (book) =>
        `${book.id}:${book.updatedAt}:${book.source.ref?.hash ?? ""}:${book.sections.length}`,
    )
    .join("\u0000");
  const session: PersistedReaderSession = {
    version: 1,
    activeBookId: state.activeBookId,
    progressByBook: state.progressByBook,
    settings: state.settings,
    bookmarksByBook: state.bookmarksByBook,
    annotationsByBook: state.annotationsByBook,
    searchSession: {
      query: state.query,
      searchBookId: state.searchBookId,
      searchOpen: state.searchOpen,
    },
  };
  const sessionRaw = JSON.stringify(session);
  if (persistedLibrarySignatures.get(runtime) !== librarySignature) {
    const library: PersistedReaderLibrary = { version: 1, books };
    const legacy: PersistedReaderSnapshot = {
      ...library,
      activeBookId: state.activeBookId,
      progressByBook: state.progressByBook,
      settings: state.settings,
      bookmarksByBook: state.bookmarksByBook,
      annotationsByBook: state.annotationsByBook,
      searchSession: {
        query: state.query,
        searchBookId: state.searchBookId,
        searchOpen: state.searchOpen,
      },
    };
    const libraryRaw = JSON.stringify(library);
    const legacyRaw = JSON.stringify(legacy);
    const librarySaved = await writeReaderValue(
      runtime,
      READER_LIBRARY_META_KEY,
      READER_LIBRARY_STORAGE_KEY,
      libraryRaw,
      true,
    );
    await writeReaderValue(runtime, READER_META_KEY, READER_STORAGE_KEY, legacyRaw, true);
    if (librarySaved) persistedLibrarySignatures.set(runtime, librarySignature);
  }
  await writeReaderValue(
    runtime,
    READER_SESSION_META_KEY,
    READER_SESSION_STORAGE_KEY,
    sessionRaw,
    false,
  );
}

async function writeReaderValue(
  runtime: ReaderRuntime,
  metaKey: string,
  storageKey: string,
  raw: string,
  mirrorLocal: boolean,
): Promise<boolean> {
  let saved = false;
  if (runtime.meta !== undefined) {
    try {
      await runtime.meta.kvSet(metaKey, raw);
      saved = true;
    } catch {
      // Fall through to localStorage when SQLite is temporarily unavailable.
    }
  }
  try {
    if ((!saved || mirrorLocal) && typeof localStorage !== "undefined") {
      localStorage.setItem(storageKey, raw);
      saved = true;
    }
  } catch {
    // Private browsing can deny localStorage; in-memory reading still works.
  }
  return saved;
}

function localStorageSnapshot(key: string): string | undefined {
  try {
    if (typeof localStorage === "undefined") return undefined;
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

async function readerValue(
  runtime: ReaderRuntime,
  metaKey: string,
  storageKey: string,
): Promise<string | undefined> {
  const local = localStorageSnapshot(storageKey);
  if (runtime.meta === undefined) return local;
  try {
    return (await runtime.meta.kvGet(metaKey)) ?? local;
  } catch {
    return local;
  }
}

function restoredBookmarks(
  books: ReadonlyArray<ReaderBook>,
  raw: unknown,
): ReaderState["bookmarksByBook"] {
  if (typeof raw !== "object" || raw === null) return {};
  const source = raw as Record<string, unknown>;
  const restored: Record<string, ReadonlyArray<ReaderBookmark>> = {};
  for (const book of books) {
    const candidates = source[book.id];
    if (!Array.isArray(candidates)) continue;
    const seen = new Set<string>();
    const bookmarks = candidates.flatMap((candidate) => {
      if (typeof candidate !== "object" || candidate === null) return [];
      const value = candidate as Record<string, unknown>;
      if (
        typeof value["id"] !== "string" ||
        typeof value["label"] !== "string" ||
        typeof value["createdAt"] !== "number" ||
        typeof value["locator"] !== "object" ||
        value["locator"] === null ||
        seen.has(value["id"])
      ) {
        return [];
      }
      const locatorValue = value["locator"] as Record<string, unknown>;
      if (typeof locatorValue["sectionId"] !== "string") return [];
      seen.add(value["id"]);
      const kind =
        locatorValue["kind"] === "page" || locatorValue["kind"] === "image"
          ? locatorValue["kind"]
          : "section";
      const locator = normalizeLocator(book, {
        kind,
        sectionId: locatorValue["sectionId"],
        progression:
          typeof locatorValue["progression"] === "number" ? locatorValue["progression"] : 0,
        ...(typeof locatorValue["pageNumber"] === "number"
          ? { pageNumber: locatorValue["pageNumber"] }
          : {}),
        ...(typeof locatorValue["href"] === "string" ? { href: locatorValue["href"] } : {}),
      });
      return [
        normalizeBookmark(book, {
          id: value["id"],
          label: value["label"],
          createdAt: value["createdAt"],
          locator,
        }),
      ];
    });
    if (bookmarks.length > 0) restored[book.id] = bookmarks;
  }
  return restored;
}

function restoredAnnotations(
  books: ReadonlyArray<ReaderBook>,
  raw: unknown,
): ReaderState["annotationsByBook"] {
  if (typeof raw !== "object" || raw === null) return {};
  const source = raw as Record<string, unknown>;
  const restored: Record<string, ReadonlyArray<ReaderAnnotation>> = {};
  for (const book of books) {
    const candidates = source[book.id];
    if (!Array.isArray(candidates)) continue;
    const seen = new Set<string>();
    const annotations = candidates.flatMap((candidate) => {
      if (typeof candidate !== "object" || candidate === null) return [];
      const value = candidate as Record<string, unknown>;
      if (
        typeof value["id"] !== "string" ||
        typeof value["label"] !== "string" ||
        typeof value["note"] !== "string" ||
        typeof value["createdAt"] !== "number" ||
        typeof value["updatedAt"] !== "number" ||
        typeof value["locator"] !== "object" ||
        value["locator"] === null ||
        seen.has(value["id"])
      ) {
        return [];
      }
      const locatorValue = value["locator"] as Record<string, unknown>;
      if (typeof locatorValue["sectionId"] !== "string") return [];
      seen.add(value["id"]);
      const kind =
        locatorValue["kind"] === "page" || locatorValue["kind"] === "image"
          ? locatorValue["kind"]
          : "section";
      const locator = normalizeLocator(book, {
        kind,
        sectionId: locatorValue["sectionId"],
        progression:
          typeof locatorValue["progression"] === "number" ? locatorValue["progression"] : 0,
        ...(typeof locatorValue["pageNumber"] === "number"
          ? { pageNumber: locatorValue["pageNumber"] }
          : {}),
        ...(typeof locatorValue["href"] === "string" ? { href: locatorValue["href"] } : {}),
      });
      return [
        normalizeAnnotation(book, {
          id: value["id"],
          label: value["label"],
          note: value["note"].slice(0, 2_000),
          createdAt: value["createdAt"],
          updatedAt: Math.max(value["createdAt"], value["updatedAt"]),
          locator,
        }),
      ];
    });
    if (annotations.length > 0) restored[book.id] = annotations;
  }
  return restored;
}

function restoredSearchSession(
  books: ReadonlyArray<ReaderBook>,
  raw: unknown,
): ReaderSearchSession {
  if (typeof raw !== "object" || raw === null) {
    return { query: "", searchBookId: null, searchOpen: false };
  }
  const source = raw as Record<string, unknown>;
  const query = typeof source["query"] === "string" ? source["query"].slice(0, 240) : "";
  const searchBookId =
    typeof source["searchBookId"] === "string" &&
    books.some((book) => book.id === source["searchBookId"])
      ? source["searchBookId"]
      : null;
  return {
    query,
    searchBookId,
    searchOpen: query.trim().length > 0 && source["searchOpen"] === true,
  };
}

async function fileFromSource(
  runtime: ReaderRuntime,
  book: PersistedBook,
): Promise<File | undefined> {
  const ref = book.source.ref;
  if (ref === undefined) return undefined;
  const blob =
    runtime.binary.getBlob === undefined
      ? undefined
      : await runtime.binary.getBlob(artifactPath(ref));
  if (blob !== undefined) return new File([blob], book.source.name, { type: book.source.mime });
  const artifactRef: ArtifactRef = {
    id: ref.id,
    type: "file/publication",
    storage: ref.storage,
    format: ref.mime,
    hash: ref.hash,
  };
  const bytes = await Effect.runPromise(runtime.artifacts.get(artifactRef));
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return new File([buffer], book.source.name, { type: book.source.mime });
}

async function restoreBook(
  runtime: ReaderRuntime,
  persisted: PersistedBook,
): Promise<ReaderBook | undefined> {
  const hasBinaryView =
    persisted.source.format === "epub" ||
    persisted.source.format === "cbz" ||
    persisted.source.format === "pdf";
  if (hasBinaryView && persisted.source.ref !== undefined) {
    try {
      const file = await fileFromSource(runtime, persisted);
      if (file !== undefined) {
        const reopened = await openReaderFile(file, persisted.id);
        return {
          ...reopened,
          title: persisted.title,
          ...(persisted.author === undefined ? {} : { author: persisted.author }),
          ...(persisted.language === undefined ? {} : { language: persisted.language }),
          importedAt: persisted.importedAt,
          updatedAt: persisted.updatedAt,
          tags: persisted.tags,
          source: {
            ...reopened.source,
            name: persisted.source.name,
            mime: persisted.source.mime,
            size: persisted.source.size,
            ref: persisted.source.ref,
          },
        };
      }
    } catch {
      return undefined;
    }
  }
  return {
    id: persisted.id,
    title: persisted.title,
    ...(persisted.author === undefined ? {} : { author: persisted.author }),
    ...(persisted.language === undefined ? {} : { language: persisted.language }),
    source: {
      name: persisted.source.name,
      format: persisted.source.format,
      mime: persisted.source.mime,
      size: persisted.source.size,
      ...(persisted.source.ref === undefined ? {} : { ref: persisted.source.ref }),
    },
    sections: persisted.sections,
    importedAt: persisted.importedAt,
    updatedAt: persisted.updatedAt,
    tags: persisted.tags,
  };
}

export async function restoreReader(
  runtime: ReaderRuntime,
): Promise<RestoredReaderSnapshot | undefined> {
  const legacyRaw = await readerValue(runtime, READER_META_KEY, READER_STORAGE_KEY);
  const libraryRaw = await readerValue(
    runtime,
    READER_LIBRARY_META_KEY,
    READER_LIBRARY_STORAGE_KEY,
  );
  const sessionRaw = await readerValue(
    runtime,
    READER_SESSION_META_KEY,
    READER_SESSION_STORAGE_KEY,
  );
  const legacy = parsePersisted<Partial<PersistedReaderSnapshot>>(legacyRaw);
  const library = parsePersisted<Partial<PersistedReaderLibrary>>(libraryRaw);
  const session = parsePersisted<Partial<PersistedReaderSession>>(sessionRaw);
  const booksPayload =
    library?.version === 1 && Array.isArray(library.books)
      ? library.books
      : legacy?.version === 1 && Array.isArray(legacy.books)
        ? legacy.books
        : undefined;
  if (booksPayload === undefined) return undefined;
  try {
    const books: ReaderBook[] = [];
    for (const persisted of booksPayload) {
      const book = await restoreBook(runtime, persisted);
      if (book !== undefined) books.push(book);
    }
    const source = session?.version === 1 ? session : legacy?.version === 1 ? legacy : undefined;
    return {
      books,
      activeBookId:
        typeof source?.activeBookId === "string" ? source.activeBookId : (books[0]?.id ?? null),
      progressByBook: source?.progressByBook ?? {},
      settings: { ...DEFAULT_READER_SETTINGS, ...source?.settings },
      bookmarksByBook: restoredBookmarks(books, source?.bookmarksByBook),
      annotationsByBook: restoredAnnotations(books, source?.annotationsByBook),
      searchSession: restoredSearchSession(books, source?.searchSession),
    };
  } catch {
    return undefined;
  }
}

function parsePersisted<T>(raw: string | undefined): T | undefined {
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

export async function indexBook(
  runtime: ReaderRuntime,
  book: ReaderBook,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  if (runtime.indexSession !== undefined) {
    try {
      await runtime.indexSession.indexBook(book, signal);
    } catch (reason) {
      if (signal?.aborted) throw reason;
      // Search has SQLite/JS fallbacks; a failed worker must not make a book unreadable.
    }
  }
  if (!runtime.ftsReady || runtime.meta === undefined) return;
  try {
    runtime.meta.run("DELETE FROM reader_fts WHERE book_id = ?", [book.id]);
    for (const section of book.sections) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      runtime.meta.run(
        "INSERT INTO reader_fts (book_id, section_id, label, body) VALUES (?, ?, ?, ?)",
        [book.id, section.id, section.label, section.text],
      );
    }
    await runtime.meta.persist();
  } catch (reason) {
    if (signal?.aborted) throw reason;
    // Search always has a JS fallback. A failed index should not make a book unreadable.
  }
}

export function searchIndexed(
  runtime: ReaderRuntime,
  books: ReadonlyArray<ReaderBook>,
  query: string,
): ReadonlyArray<SearchHit> {
  const normalized = normalizeSearchQuery(query);
  if (!normalized) return [];
  const workerResults = runtime.indexSession?.search(books, query);
  if (workerResults !== undefined) return workerResults;
  if (!runtime.ftsReady || runtime.meta === undefined || normalized.length < 3)
    return searchLibrary(books, query);
  try {
    const escaped = normalized.replaceAll('"', '""');
    const rows = runtime.meta.all(
      "SELECT book_id, section_id, label, snippet(reader_fts, 3, '<mark>', '</mark>', '…', 18) AS snippet, bm25(reader_fts) AS rank FROM reader_fts WHERE reader_fts MATCH ? ORDER BY rank LIMIT 80",
      [`"${escaped}"`],
    );
    if (rows.length === 0) return searchLibrary(books, query);
    return rows.map((row) => ({
      bookId: String(row["book_id"] ?? ""),
      sectionId: String(row["section_id"] ?? ""),
      label: String(row["label"] ?? "正文"),
      snippet: String(row["snippet"] ?? "").replace(/<\/?mark>/gu, ""),
      score: Number(row["rank"] ?? 0),
      matchStart: 0,
      matchLength: normalized.length,
    }));
  } catch {
    return searchLibrary(books, query);
  }
}
