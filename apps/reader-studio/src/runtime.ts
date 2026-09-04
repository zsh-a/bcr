import {
  artifactPath,
  artifactStore,
  ArtifactStoreTag,
  contentHash,
  hashReadableStream,
  type ArtifactRef,
  type ArtifactStore,
} from "@bcr/core";
import { isOpfsSupported, MemoryStore, OpfsStore, type BinaryStore } from "@bcr/storage-opfs";
import type { SqliteDb, SqliteModule } from "@bcr/storage-sqlite";
import { Context, Effect, Layer } from "effect";
import {
  normalizeAnnotation,
  normalizeBookmark,
  normalizeLocator,
  normalizeSearchQuery,
  makeSnippet,
  searchLibrary,
  searchTextRange,
  type ReaderBook,
  type ReaderAnnotation,
  type ReaderBookmark,
  type ReaderTextAnchor,
  type SearchHit,
} from "@bcr/reader-core";
import {
  decodeDocumentExportBundle,
  decodeDocumentContentPackage,
  decodeDocumentTranslationPackage,
  type DocumentContentPackage,
  type DocumentHandoff,
  type DocumentTranslationPackage,
} from "@bcr/document-core";
import { formatForFile, openReaderContentPackage, openReaderFile } from "./adapters";
import { readerBookToDocumentContent } from "./document-adapter";
import {
  createReaderParseSession,
  ReaderParseWorkerError,
  type ReaderParseSession,
} from "./parse-session";
import {
  DEFAULT_READER_SETTINGS,
  type ReaderSearchSession,
  type ReaderSettings,
  type ReaderState,
} from "./model";
import { createLazyReaderIndexSession, type ReaderIndexSession } from "./session";
import { normalizeReaderProgress } from "./session-contract";

export interface ReaderRuntime {
  readonly binary: BinaryStore;
  readonly artifacts: ArtifactStore;
  meta: SqliteDb | undefined;
  ftsReady: boolean;
  indexSession: ReaderIndexSession | undefined;
  parseSession: ReaderParseSession | undefined;
  parserMode: "worker" | "main";
}

export interface PersistReaderOptions {
  /** Set false when the caller has already mirrored the latest session synchronously. */
  readonly mirrorSession?: boolean;
}

export interface ReaderSearchResult {
  readonly hits: ReadonlyArray<SearchHit>;
  readonly indexing: boolean;
}

interface SqliteInit {
  (options?: { locateFile?: (file: string) => string }): Promise<SqliteModule>;
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
  readonly toc?: ReaderBook["toc"];
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
  readonly recovery: ReaderRestoreDiagnostics;
}

export interface ReaderRestoreIssue {
  readonly bookId: string;
  readonly name: string;
  readonly reason: string;
  readonly sourceRef?: ReaderBook["source"]["ref"] | undefined;
}

/** Non-fatal restore facts surfaced to the Reader UI after a durable boot. */
export interface ReaderRestoreDiagnostics {
  readonly attemptedBooks: number;
  readonly restoredBooks: number;
  readonly skippedBooks: ReadonlyArray<ReaderRestoreIssue>;
  readonly usedLegacyLibrary: boolean;
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

async function parseReaderFile(
  runtime: ReaderRuntime,
  file: File,
  id: string,
  signal?: AbortSignal,
): Promise<ReaderBook> {
  const format = formatForFile(file);
  // PDF.js owns a rendering worker and keeps a Blob URL for canvas pages; keep
  // its lifecycle on the main thread until the dedicated page renderer lands.
  if (format === "pdf") {
    return openReaderFile(file, id, signal);
  }
  runtime.parseSession ??= createReaderParseSession();
  runtime.parserMode = runtime.parseSession === undefined ? "main" : "worker";
  if (runtime.parseSession === undefined) return openReaderFile(file, id, signal);
  try {
    return await runtime.parseSession.open(file, id, signal);
  } catch (reason) {
    if (signal?.aborted) throw reason;
    if (reason instanceof ReaderParseWorkerError) return openReaderFile(file, id, signal);
    throw reason;
  }
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
  const book = await parseReaderFile(runtime, file, `book-${hash.slice(0, 16)}`, signal);
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

/** Import a Document Studio handoff without parsing the publication twice. */
export async function importReaderContentPackage(
  runtime: ReaderRuntime,
  file: File,
  content: DocumentContentPackage,
  translation?: DocumentTranslationPackage,
  signal?: AbortSignal,
): Promise<ReaderBook> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const hash = await hashReadableStream(file.stream());
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const storage: ArtifactRef["storage"] = runtime.binary instanceof MemoryStore ? "memory" : "opfs";
  const ref: ArtifactRef = {
    id: `reader/${hash}`,
    type: "file/publication",
    storage,
    format: file.type || content.format,
    hash,
  };
  await Effect.runPromise(runtime.artifacts.putStream(ref, file.stream()));
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const book = openReaderContentPackage(file, `book-${hash.slice(0, 16)}`, content, translation);
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

/** Import a canonical JSON export without invoking a format-specific parser. */
export async function importReaderExportBundle(
  runtime: ReaderRuntime,
  file: File,
  signal?: AbortSignal,
): Promise<ReaderBook> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  let value: unknown;
  try {
    value = JSON.parse(await file.text()) as unknown;
  } catch {
    throw new Error(`${file.name} 不是有效的 Document Export Bundle`);
  }
  const bundle = decodeDocumentExportBundle(value);
  if (bundle === undefined) throw new Error(`${file.name} 的 Export Bundle 契约校验失败`);
  if (bundle.content.format === "image") {
    throw new Error("视觉 Export Bundle 请交给 Manga Studio；Reader 只接收文本出版物");
  }
  return importReaderContentPackage(runtime, file, bundle.content, bundle.translation, signal);
}

function mimeForDocumentFormat(format: DocumentHandoff["format"]): string {
  switch (format) {
    case "pdf":
      return "application/pdf";
    case "epub":
    case "cbz":
      return "application/zip";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "html":
      return "text/html";
    case "markdown":
      return "text/markdown";
    case "image":
      return "image/*";
    default:
      return "text/plain";
  }
}

async function fileFromHandoffArtifact(
  artifacts: ArtifactStore,
  handoff: DocumentHandoff,
): Promise<File> {
  if (handoff.sourceRef === undefined) {
    throw new Error("Document handoff 缺少可恢复的 source Artifact");
  }
  const blob = await Effect.runPromise(artifacts.getBlob(handoff.sourceRef));
  return new File([blob], handoff.name, {
    type: handoff.sourceRef.format ?? mimeForDocumentFormat(handoff.format),
  });
}

async function packageFromArtifact<T>(
  artifacts: ArtifactStore,
  ref: ArtifactRef,
  decode: (value: unknown) => T | undefined,
): Promise<T> {
  const bytes = await Effect.runPromise(artifacts.get(ref));
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new Error(`Document handoff Artifact ${ref.id} 不是有效 JSON`);
  }
  const decoded = decode(value);
  if (decoded === undefined) throw new Error(`Document handoff Artifact ${ref.id} 契约校验失败`);
  return decoded;
}

/**
 * Import a Document handoff from either its tab-local fast path or durable
 * Artifact refs. Upstream artifacts can be supplied by the Studio host when
 * the target app owns a separate OPFS namespace.
 */
export async function importReaderDocumentHandoff(
  runtime: ReaderRuntime,
  handoff: DocumentHandoff,
  upstreamArtifacts?: ArtifactStore,
  signal?: AbortSignal,
): Promise<ReaderBook> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const artifacts = upstreamArtifacts ?? runtime.artifacts;
  const file = handoff.file ?? (await fileFromHandoffArtifact(artifacts, handoff));
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const content =
    handoff.content ??
    (handoff.contentRef === undefined
      ? undefined
      : await packageFromArtifact(artifacts, handoff.contentRef, decodeDocumentContentPackage));
  const translation =
    handoff.translation ??
    (handoff.translationRef === undefined
      ? undefined
      : await packageFromArtifact(
          artifacts,
          handoff.translationRef,
          decodeDocumentTranslationPackage,
        ));
  if (content === undefined) return importReaderFile(runtime, file, signal);
  return importReaderContentPackage(runtime, file, content, translation, signal);
}

export interface ReaderDocumentHandoffPayload {
  readonly file: File;
  readonly sourceRef: ArtifactRef;
  readonly content: DocumentContentPackage;
  readonly contentRef: ArtifactRef;
}

function sourceExtension(name: string): string {
  return name.split(".").pop()?.toLocaleLowerCase() || "bin";
}

/**
 * Materialize a Reader publication in the host Document namespace and write
 * its canonical projection. Both refs are content-addressed, so a refresh or
 * a separate target tab can rebuild the handoff without a File handle.
 */
export async function prepareReaderDocumentHandoff(
  runtime: ReaderRuntime,
  hostArtifacts: ArtifactStore,
  book: ReaderBook,
): Promise<ReaderDocumentHandoffPayload> {
  const source = book.source.ref;
  if (source === undefined) {
    throw new Error("示例读物没有可交接的源 Artifact，请先导入原始文件");
  }
  const sourceArtifact: ArtifactRef = {
    id: source.id,
    type: "file/publication",
    storage: source.storage,
    format: source.mime,
    hash: source.hash,
  };
  const blob = await Effect.runPromise(runtime.artifacts.getBlob(sourceArtifact));
  const file = new File([blob], book.source.name, { type: book.source.mime });
  const sourceRef: ArtifactRef = {
    id: `document/source/${source.hash}`,
    type: `file/${sourceExtension(book.source.name)}`,
    storage: "opfs",
    format: book.source.mime || undefined,
    hash: source.hash,
  };
  await Effect.runPromise(hostArtifacts.putStream(sourceRef, blob.stream()));

  const content = readerBookToDocumentContent(book, sourceRef);
  const bytes = new TextEncoder().encode(JSON.stringify(content));
  const hash = contentHash(bytes);
  const contentRef: ArtifactRef = {
    id: `document/content/reader/${hash}`,
    type: "document/content-package",
    storage: "opfs",
    format: "json",
    hash,
  };
  await Effect.runPromise(hostArtifacts.put(contentRef, bytes));
  return { file, sourceRef, content, contentRef };
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
    ...(book.toc === undefined ? {} : { toc: book.toc }),
    importedAt: book.importedAt,
    updatedAt: book.updatedAt,
    tags: book.tags,
  };
}

export async function persistReader(
  runtime: ReaderRuntime,
  state: ReaderState,
  options: PersistReaderOptions = {},
): Promise<void> {
  const mirrorSession = options.mirrorSession ?? true;
  const books = state.library.map(persistBook);
  const librarySignature = state.library
    .map(
      (book) =>
        `${book.id}:${book.updatedAt}:${book.source.ref?.hash ?? ""}:${book.sections.length}`,
    )
    .join("\u0000");
  const session = persistedReaderSession(state);
  const sessionRaw = JSON.stringify(session);
  // Make the small session durable even when the async metadata backend is
  // unavailable or the mobile page is terminated during a pending write.
  if (mirrorSession) mirrorReaderSession(state);
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
    mirrorSession,
    mirrorSession,
  );
}

function persistedReaderSession(state: ReaderState): PersistedReaderSession {
  return {
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
}

/** Synchronous best-effort mirror used by pagehide/visibilitychange flushes. */
export function mirrorReaderSession(state: ReaderState): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(READER_SESSION_STORAGE_KEY, JSON.stringify(persistedReaderSession(state)));
  } catch {
    // Private browsing or a full quota is handled by the async metadata path.
  }
}

async function writeReaderValue(
  runtime: ReaderRuntime,
  metaKey: string,
  storageKey: string,
  raw: string,
  mirrorLocal: boolean,
  fallbackLocal = true,
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
    if ((mirrorLocal || (!saved && fallbackLocal)) && typeof localStorage !== "undefined") {
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

function textAnchorValue(value: unknown): ReaderTextAnchor | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const source = value as Record<string, unknown>;
  const exact = source["exact"];
  if (typeof exact !== "string" || exact.length === 0) return undefined;
  const prefix = source["prefix"];
  const suffix = source["suffix"];
  const start = source["start"];
  const end = source["end"];
  return {
    exact: exact.slice(0, 512),
    ...(typeof prefix === "string" ? { prefix: prefix.slice(-96) } : {}),
    ...(typeof suffix === "string" ? { suffix: suffix.slice(0, 96) } : {}),
    ...(typeof start === "number" && Number.isInteger(start) && start >= 0 ? { start } : {}),
    ...(typeof end === "number" && Number.isInteger(end) && end >= 0 ? { end } : {}),
  };
}

async function readerValue(
  runtime: ReaderRuntime,
  metaKey: string,
  storageKey: string,
  preferLocal = false,
): Promise<string | undefined> {
  const local = localStorageSnapshot(storageKey);
  if (preferLocal && local !== undefined) return local;
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
      const textAnchor = textAnchorValue(locatorValue["textAnchor"]);
      const locator = normalizeLocator(book, {
        kind,
        sectionId: locatorValue["sectionId"],
        progression:
          typeof locatorValue["progression"] === "number" ? locatorValue["progression"] : 0,
        ...(typeof locatorValue["pageNumber"] === "number"
          ? { pageNumber: locatorValue["pageNumber"] }
          : {}),
        ...(typeof locatorValue["href"] === "string" ? { href: locatorValue["href"] } : {}),
        ...(textAnchor === undefined ? {} : { textAnchor }),
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
      const textAnchor = textAnchorValue(locatorValue["textAnchor"]);
      const locator = normalizeLocator(book, {
        kind,
        sectionId: locatorValue["sectionId"],
        progression:
          typeof locatorValue["progression"] === "number" ? locatorValue["progression"] : 0,
        ...(typeof locatorValue["pageNumber"] === "number"
          ? { pageNumber: locatorValue["pageNumber"] }
          : {}),
        ...(typeof locatorValue["href"] === "string" ? { href: locatorValue["href"] } : {}),
        ...(textAnchor === undefined ? {} : { textAnchor }),
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

interface RestoredBookResult {
  readonly book?: ReaderBook | undefined;
  readonly issue?: ReaderRestoreIssue | undefined;
}

function restoreIssue(persisted: PersistedBook, reason: unknown): ReaderRestoreIssue {
  const message =
    reason instanceof Error && reason.message.length > 0 ? reason.message : String(reason);
  return {
    bookId: persisted.id,
    name: persisted.source?.name || persisted.title || persisted.id,
    reason: message.length > 0 ? message : "无法读取出版物内容",
    ...(persisted.source?.ref === undefined ? {} : { sourceRef: persisted.source.ref }),
  };
}

async function restoreBook(
  runtime: ReaderRuntime,
  persisted: PersistedBook,
): Promise<RestoredBookResult> {
  const hasBinaryView =
    persisted.source.format === "docx" ||
    persisted.source.format === "epub" ||
    persisted.source.format === "cbz" ||
    persisted.source.format === "pdf";
  if (hasBinaryView && persisted.source.ref !== undefined) {
    try {
      const file = await fileFromSource(runtime, persisted);
      if (file !== undefined) {
        const reopened = await parseReaderFile(runtime, file, persisted.id);
        return {
          book: {
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
            ...(persisted.toc === undefined ? {} : { toc: persisted.toc }),
          },
        };
      }
      return { issue: restoreIssue(persisted, "源 Artifact 不可用，无法重新打开二进制出版物") };
    } catch (reason) {
      return { issue: restoreIssue(persisted, reason) };
    }
  }
  try {
    return {
      book: {
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
        ...(persisted.toc === undefined ? {} : { toc: persisted.toc }),
        importedAt: persisted.importedAt,
        updatedAt: persisted.updatedAt,
        tags: persisted.tags,
      },
    };
  } catch (reason) {
    return { issue: restoreIssue(persisted, reason) };
  }
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
    true,
  );
  const legacy = parsePersisted<Partial<PersistedReaderSnapshot>>(legacyRaw);
  const library = parsePersisted<Partial<PersistedReaderLibrary>>(libraryRaw);
  const session = parsePersisted<Partial<PersistedReaderSession>>(sessionRaw);
  const hasCanonicalLibrary = library?.version === 1 && Array.isArray(library.books);
  const booksPayload = hasCanonicalLibrary
    ? library.books
    : legacy?.version === 1 && Array.isArray(legacy.books)
      ? legacy.books
      : undefined;
  if (booksPayload === undefined) return undefined;
  try {
    const source = session?.version === 1 ? session : legacy?.version === 1 ? legacy : undefined;
    const persistedBooks = booksPayload as ReadonlyArray<PersistedBook>;
    // Binary readers already isolate parsing in their own workers where
    // possible. Restore publications concurrently so a large local library
    // does not serialize DOCX/EPUB/PDF work behind the first entry.
    const restored = await Promise.all(
      persistedBooks.map(async (persisted, index) => ({
        index,
        book: await restoreBook(runtime, persisted),
      })),
    );
    const books = restored
      .sort((left, right) => left.index - right.index)
      .flatMap((entry) => (entry.book.book === undefined ? [] : [entry.book.book]));
    const skippedBooks = restored.flatMap((entry) =>
      entry.book.issue === undefined ? [] : [entry.book.issue],
    );
    return {
      books,
      activeBookId:
        typeof source?.activeBookId === "string" ? source.activeBookId : (books[0]?.id ?? null),
      progressByBook: normalizeReaderProgress(books, source?.progressByBook),
      settings: { ...DEFAULT_READER_SETTINGS, ...source?.settings },
      bookmarksByBook: restoredBookmarks(books, source?.bookmarksByBook),
      annotationsByBook: restoredAnnotations(books, source?.annotationsByBook),
      searchSession: restoredSearchSession(books, source?.searchSession),
      recovery: {
        attemptedBooks: persistedBooks.length,
        restoredBooks: books.length,
        skippedBooks,
        usedLegacyLibrary: !hasCanonicalLibrary,
      },
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

export function searchIndexedDetailed(
  runtime: ReaderRuntime,
  books: ReadonlyArray<ReaderBook>,
  query: string,
): ReaderSearchResult {
  const normalized = normalizeSearchQuery(query);
  if (!normalized) return { hits: [], indexing: false };
  const workerResults = runtime.indexSession?.search(books, query);
  if (workerResults !== undefined) {
    const indexedBookIds = new Set(workerResults.indexedBookIds);
    const pendingBooks = books.filter((book) => !indexedBookIds.has(book.id));
    return {
      hits: [...workerResults.hits, ...searchLibrary(pendingBooks, query)]
        .sort(
          (left, right) =>
            right.score - left.score || left.sectionId.localeCompare(right.sectionId),
        )
        .slice(0, 80),
      indexing: workerResults.pendingBookIds.length > 0,
    };
  }
  if (!runtime.ftsReady || runtime.meta === undefined || normalized.length < 3)
    return { hits: searchLibrary(books, query), indexing: false };
  try {
    const escaped = normalized.replaceAll('"', '""');
    const rows = runtime.meta.all(
      "SELECT book_id, section_id, label, snippet(reader_fts, 3, '<mark>', '</mark>', '…', 18) AS snippet, bm25(reader_fts) AS rank FROM reader_fts WHERE reader_fts MATCH ? ORDER BY rank LIMIT 80",
      [`"${escaped}"`],
    );
    if (rows.length === 0) return { hits: searchLibrary(books, query), indexing: false };
    return {
      hits: rows.flatMap((row) => {
        const bookId = String(row["book_id"] ?? "");
        const sectionId = String(row["section_id"] ?? "");
        const book = books.find((candidate) => candidate.id === bookId);
        const section = book?.sections.find((candidate) => candidate.id === sectionId);
        if (section === undefined) return [];
        const range = searchTextRange(section.text, query);
        return [
          {
            bookId,
            sectionId,
            label: String(row["label"] ?? section.label ?? "正文"),
            snippet:
              range === undefined
                ? String(row["snippet"] ?? "").replace(/<\/?mark>/gu, "")
                : makeSnippet(section.text, range.start, range.length),
            score: Number(row["rank"] ?? 0),
            matchStart: range?.start ?? 0,
            matchLength: range?.length ?? normalized.length,
          },
        ];
      }),
      indexing: false,
    };
  } catch {
    return { hits: searchLibrary(books, query), indexing: false };
  }
}

export function searchIndexed(
  runtime: ReaderRuntime,
  books: ReadonlyArray<ReaderBook>,
  query: string,
): ReadonlyArray<SearchHit> {
  return searchIndexedDetailed(runtime, books, query).hits;
}
