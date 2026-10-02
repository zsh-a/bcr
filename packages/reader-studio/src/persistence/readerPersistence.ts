import { type ReaderState } from "../state/model";
import type { ReaderRuntime } from "../runtime/readerRuntimeCore";
import {
  type PersistReaderOptions,
  type PersistedReaderLibrary,
  type PersistedReaderSnapshot,
  type PersistedReaderSession,
} from "./model";
import { readerLibrarySignature, persistBook } from "./codec";
import {
  writeReaderValue,
  READER_LIBRARY_META_KEY,
  READER_LIBRARY_STORAGE_KEY,
  READER_META_KEY,
  READER_STORAGE_KEY,
  READER_SESSION_META_KEY,
  READER_SESSION_STORAGE_KEY,
} from "./storage";

const persistedLocalLibrarySignatures = new WeakMap<ReaderRuntime, string>();

const persistedMetadataLibrarySignatures = new WeakMap<ReaderRuntime, string>();

export async function persistReader(
  runtime: ReaderRuntime,
  state: ReaderState,
  options: PersistReaderOptions = {},
): Promise<void> {
  const check = options.assertCurrent ?? (() => {});
  check();
  const mirrorSession = options.mirrorSession ?? true;
  const librarySignature = readerLibrarySignature(state.library);
  const session = persistedReaderSession(state);
  const sessionRaw = JSON.stringify(session);
  // Make the small session durable even when the async metadata backend is
  // unavailable or the mobile page is terminated during a pending write.
  if (mirrorSession) mirrorReaderSession(state);
  const localLibraryOutdated =
    options.forceLibrary === true ||
    persistedLocalLibrarySignatures.get(runtime) !== librarySignature;
  const metadataLibraryOutdated =
    runtime.meta !== undefined &&
    (options.forceLibrary === true ||
      persistedMetadataLibrarySignatures.get(runtime) !== librarySignature);
  if (localLibraryOutdated || metadataLibraryOutdated) {
    const books = state.library.map(persistBook);
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
      true,
      check,
    );
    if (!librarySaved.local && !librarySaved.metadata && localLibraryOutdated)
      throw new Error("书库未能保存：本地存储不可用或空间不足");
    await writeReaderValue(
      runtime,
      READER_META_KEY,
      READER_STORAGE_KEY,
      legacyRaw,
      localLibraryOutdated,
      true,
      check,
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
    check,
  );
  check();
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
