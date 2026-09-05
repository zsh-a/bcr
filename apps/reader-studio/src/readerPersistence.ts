import { artifactPath, type ArtifactRef } from "@bcr/core";
import { Effect } from "effect";
import {
  normalizeAnnotation,
  normalizeBookmark,
  normalizeLocator,
  type ReaderAnnotation,
  type ReaderBook,
  type ReaderBookmark,
  type ReaderTextAnchor,
} from "@bcr/reader-core";
import {
  DEFAULT_READER_SETTINGS,
  type ReaderSearchSession,
  type ReaderSettings,
  type ReaderState,
} from "./model";
import { normalizeReaderProgress } from "./session-contract";
import { parseReaderFile } from "./readerImports";
import type { ReaderRuntime } from "./readerRuntimeCore";

export interface PersistReaderOptions {
  /** Set false when the caller has already mirrored the latest session synchronously. */
  readonly mirrorSession?: boolean;
}
export interface PersistedBook {
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
    readonly pageAspectRatio?: number | undefined;
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
  readonly librarySignature?: string | undefined;
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
  readonly navigationHistory?: ReaderState["navigationHistory"];
  readonly version: 1;
  readonly librarySignature?: string | undefined;
  readonly activeBookId?: string | null;
  readonly progressByBook?: ReaderState["progressByBook"];
  readonly settings?: ReaderSettings;
  readonly bookmarksByBook?: ReaderState["bookmarksByBook"];
  readonly annotationsByBook?: ReaderState["annotationsByBook"];
  readonly searchSession?: ReaderSearchSession;
}

interface RestoredReaderSnapshot {
  readonly navigationHistory: ReaderState["navigationHistory"];
  readonly books: ReadonlyArray<ReaderBook>;
  readonly libraryOutdated: boolean;
  readonly activeBookId: string | null;
  readonly progressByBook: ReaderState["progressByBook"];
  readonly settings: ReaderSettings;
  readonly bookmarksByBook: ReaderState["bookmarksByBook"];
  readonly annotationsByBook: ReaderState["annotationsByBook"];
  readonly searchSession: ReaderSearchSession;
  readonly recovery: ReaderRestoreDiagnostics;
  readonly pendingBookIds: ReadonlyArray<string>;
}

export interface ReaderBookRestoreBatch {
  readonly books: ReadonlyArray<ReaderBook>;
  readonly issues: ReadonlyArray<ReaderRestoreIssue>;
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

const READER_STORAGE_KEY = "bcr.reader.state.v1";
const READER_LIBRARY_STORAGE_KEY = "bcr.reader.library.v1";
const READER_SESSION_STORAGE_KEY = "bcr.reader.session.v1";
const READER_META_KEY = "reader/state";
const READER_LIBRARY_META_KEY = "reader/library";
const READER_SESSION_META_KEY = "reader/session";

const persistedLocalLibrarySignatures = new WeakMap<ReaderRuntime, string>();
const persistedMetadataLibrarySignatures = new WeakMap<ReaderRuntime, string>();
export function persistBook(book: ReaderBook): PersistedBook {
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
      ...(section.pageAspectRatio === undefined
        ? {}
        : { pageAspectRatio: section.pageAspectRatio }),
      ...(section.href === undefined ? {} : { href: section.href }),
      ...(section.imageAlt === undefined ? {} : { imageAlt: section.imageAlt }),
    })),
    ...(book.toc === undefined ? {} : { toc: book.toc }),
    importedAt: book.importedAt,
    updatedAt: book.updatedAt,
    tags: book.tags,
  };
}

function readerLibrarySignature(
  books: ReadonlyArray<{
    readonly id: string;
    readonly updatedAt: number;
    readonly source: { readonly ref?: { readonly hash: string } | undefined };
    readonly sections: ReadonlyArray<unknown>;
  }>,
): string {
  return books
    .map(
      (book) =>
        `${book.id}:${book.updatedAt}:${book.source.ref?.hash ?? ""}:${book.sections.length}`,
    )
    .join("\u0000");
}

export async function persistReader(
  runtime: ReaderRuntime,
  state: ReaderState,
  options: PersistReaderOptions = {},
): Promise<void> {
  const mirrorSession = options.mirrorSession ?? true;
  const books = state.library.map(persistBook);
  const librarySignature = readerLibrarySignature(state.library);
  const session = persistedReaderSession(state);
  const sessionRaw = JSON.stringify(session);
  // Make the small session durable even when the async metadata backend is
  // unavailable or the mobile page is terminated during a pending write.
  if (mirrorSession) mirrorReaderSession(state);
  const localLibraryOutdated = persistedLocalLibrarySignatures.get(runtime) !== librarySignature;
  const metadataLibraryOutdated =
    runtime.meta !== undefined &&
    persistedMetadataLibrarySignatures.get(runtime) !== librarySignature;
  if (localLibraryOutdated || metadataLibraryOutdated) {
    const library: PersistedReaderLibrary = { version: 1, books };
    const legacy: PersistedReaderSnapshot = {
      ...library,
      librarySignature,
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
      localLibraryOutdated,
    );
    if (!librarySaved.local && !librarySaved.metadata && localLibraryOutdated)
      throw new Error("书库未能保存：本地存储不可用或空间不足");
    await writeReaderValue(
      runtime,
      READER_META_KEY,
      READER_STORAGE_KEY,
      legacyRaw,
      localLibraryOutdated,
    );
    if (librarySaved.local) {
      persistedLocalLibrarySignatures.set(runtime, librarySignature);
    }
    if (librarySaved.metadata) {
      persistedMetadataLibrarySignatures.set(runtime, librarySignature);
    }
  }
  const sessionSaved = await writeReaderValue(
    runtime,
    READER_SESSION_META_KEY,
    READER_SESSION_STORAGE_KEY,
    sessionRaw,
    mirrorSession,
    true,
  );
  if (!sessionSaved.local && !sessionSaved.metadata)
    throw new Error("阅读记录未能保存，请检查本地存储空间后重试");
}

function persistedReaderSession(state: ReaderState): PersistedReaderSession {
  return {
    navigationHistory: state.navigationHistory,
    version: 1,
    librarySignature: readerLibrarySignature(state.library),
    activeBookId: state.activeBookId,
    progressByBook: state.progressByBook,
    settings: state.settings,
    bookmarksByBook: state.bookmarksByBook,
    annotationsByBook: state.annotationsByBook,
    searchSession: {
      query: state.query,
      searchBookId: state.searchBookId,
      searchOpen: state.searchOpen,
      scope: state.searchScope,
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

/** Synchronously mirror a changed library before a mobile page can be terminated. */
export function mirrorReaderLibrary(runtime: ReaderRuntime, state: ReaderState): boolean {
  const signature = readerLibrarySignature(state.library);
  if (persistedLocalLibrarySignatures.get(runtime) === signature) return true;
  try {
    if (typeof localStorage === "undefined") return false;
    const library: PersistedReaderLibrary = {
      version: 1,
      books: state.library.map(persistBook),
    };
    localStorage.setItem(READER_LIBRARY_STORAGE_KEY, JSON.stringify(library));
    persistedLocalLibrarySignatures.set(runtime, signature);
    return true;
  } catch {
    // The SQLite metadata copy remains the canonical fallback for large books.
    return false;
  }
}

async function writeReaderValue(
  runtime: ReaderRuntime,
  metaKey: string,
  storageKey: string,
  raw: string,
  mirrorLocal: boolean,
  fallbackLocal = true,
): Promise<{ readonly local: boolean; readonly metadata: boolean }> {
  let localSaved = false;
  let metadataSaved = false;
  const writeLocal = (): void => {
    try {
      if (typeof localStorage === "undefined") return;
      localStorage.setItem(storageKey, raw);
      localSaved = true;
    } catch {
      // Private browsing and large publications can exceed localStorage.
    }
  };
  // The synchronous mirror must happen before the first await: mobile
  // browsers may terminate the page while the SQLite write is pending.
  if (mirrorLocal) writeLocal();
  if (runtime.meta !== undefined) {
    try {
      await runtime.meta.kvSet(metaKey, raw);
      metadataSaved = true;
    } catch {
      // Fall through to localStorage when SQLite is temporarily unavailable.
    }
  }
  if (!mirrorLocal && !metadataSaved && fallbackLocal) writeLocal();
  return { local: localSaved, metadata: metadataSaved };
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

export function restoredBookmarks(
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

export function restoredAnnotations(
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
    scope: source["scope"] === "book" ? "book" : "library",
    searchOpen: query.trim().length > 0 && source["searchOpen"] === true,
  };
}

export function restoreNavigationHistory(
  books: ReadonlyArray<ReaderBook>,
  raw: unknown,
): ReaderState["navigationHistory"] {
  const source = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const restore = (value: unknown): ReaderState["navigationHistory"]["back"] => {
    if (!Array.isArray(value)) return [];
    return value.slice(-50).flatMap((entry: unknown) => {
      if (typeof entry !== "object" || entry === null) return [];
      const candidate = entry as Record<string, unknown>;
      const book = books.find((item) => item.id === candidate["bookId"]);
      const locator = candidate["locator"];
      if (book === undefined || typeof locator !== "object" || locator === null) return [];
      const fields = locator as Record<string, unknown>;
      if (
        typeof fields["sectionId"] !== "string" ||
        !book.sections.some((section) => section.id === fields["sectionId"]) ||
        typeof fields["progression"] !== "number" ||
        !Number.isFinite(fields["progression"])
      )
        return [];
      const anchor = textAnchorValue(fields["textAnchor"]);
      return [
        {
          bookId: book.id,
          locator: normalizeLocator(book, {
            kind:
              fields["kind"] === "page" || fields["kind"] === "image" ? fields["kind"] : "section",
            sectionId: fields["sectionId"],
            progression: fields["progression"],
            ...(anchor === undefined ? {} : { textAnchor: anchor }),
          }),
        },
      ];
    });
  };
  return { back: restore(source["back"]), forward: restore(source["forward"]) };
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
  signal?: AbortSignal,
): Promise<RestoredBookResult> {
  if (isBinaryBook(persisted) && persisted.source.ref !== undefined) {
    try {
      const file = await fileFromSource(runtime, persisted);
      if (file !== undefined) {
        const reopened = await parseReaderFile(runtime, file, persisted.id, signal);
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
  return projectPersistedBook(persisted);
}

function isBinaryBook(persisted: PersistedBook): boolean {
  return (
    persisted.source.format === "docx" ||
    persisted.source.format === "epub" ||
    persisted.source.format === "cbz" ||
    persisted.source.format === "pdf"
  );
}

function projectPersistedBook(persisted: PersistedBook): RestoredBookResult {
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
  options: { readonly deferBinary?: boolean } = {},
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
    const requestedActiveBookId =
      typeof source?.activeBookId === "string" ? source.activeBookId : null;
    const expectedLibrarySignature =
      typeof source?.librarySignature === "string" ? source.librarySignature : undefined;
    const libraryOutdated =
      (expectedLibrarySignature !== undefined &&
        expectedLibrarySignature !== readerLibrarySignature(persistedBooks)) ||
      (requestedActiveBookId !== null &&
        !persistedBooks.some((book) => book.id === requestedActiveBookId));
    const deferBinary = options.deferBinary === true;
    // The persisted projection already contains the normalized text model.
    // Use it for the first paint and rehydrate binary resources separately.
    const restored = deferBinary
      ? persistedBooks.map((persisted, index) => ({
          index,
          book: projectPersistedBook(persisted),
        }))
      : await Promise.all(
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
      libraryOutdated,
      navigationHistory: restoreNavigationHistory(books, session?.navigationHistory),
      activeBookId: requestedActiveBookId ?? books[0]?.id ?? null,
      progressByBook: normalizeReaderProgress(books, source?.progressByBook),
      settings: { ...DEFAULT_READER_SETTINGS, ...source?.settings },
      bookmarksByBook: restoredBookmarks(books, source?.bookmarksByBook),
      annotationsByBook: restoredAnnotations(books, source?.annotationsByBook),
      searchSession: restoredSearchSession(books, source?.searchSession),
      recovery: {
        attemptedBooks: persistedBooks.length,
        restoredBooks: books.length,
        skippedBooks: deferBinary ? [] : skippedBooks,
        usedLegacyLibrary: !hasCanonicalLibrary,
      },
      pendingBookIds: deferBinary
        ? persistedBooks
            .filter((persisted) => isBinaryBook(persisted) && persisted.source.ref !== undefined)
            .map((persisted) => persisted.id)
        : [],
    };
  } catch {
    return undefined;
  }
}

/** Rehydrate only the binary sources after the cached Reader projection is visible. */
export async function restoreReaderBooks(
  runtime: ReaderRuntime,
  bookIds: ReadonlyArray<string>,
  signal?: AbortSignal,
  onBook?: (book: ReaderBook) => void,
): Promise<ReaderBookRestoreBatch> {
  if (bookIds.length === 0) return { books: [], issues: [] };
  const legacyRaw = await readerValue(runtime, READER_META_KEY, READER_STORAGE_KEY);
  const libraryRaw = await readerValue(
    runtime,
    READER_LIBRARY_META_KEY,
    READER_LIBRARY_STORAGE_KEY,
  );
  const legacy = parsePersisted<Partial<PersistedReaderSnapshot>>(legacyRaw);
  const library = parsePersisted<Partial<PersistedReaderLibrary>>(libraryRaw);
  const hasCanonicalLibrary = library?.version === 1 && Array.isArray(library.books);
  const booksPayload = hasCanonicalLibrary
    ? library.books
    : legacy?.version === 1 && Array.isArray(legacy.books)
      ? legacy.books
      : undefined;
  if (booksPayload === undefined) return { books: [], issues: [] };

  const books: ReaderBook[] = [];
  const issues: ReaderRestoreIssue[] = [];
  const byId = new Map(
    (booksPayload as ReadonlyArray<PersistedBook>).map((book) => [book.id, book]),
  );
  for (const id of new Set(bookIds)) {
    const persisted = byId.get(id);
    if (persisted === undefined) continue;
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const restored = await restoreBook(runtime, persisted, signal);
    if (restored.book !== undefined) {
      books.push(restored.book);
      onBook?.(restored.book);
    }
    if (restored.issue !== undefined) issues.push(restored.issue);
  }
  return { books, issues };
}

function parsePersisted<T>(raw: string | undefined): T | undefined {
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}
