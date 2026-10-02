import type { ReaderRuntime } from "../runtime/readerRuntimeCore";

export const READER_STORAGE_KEY = "bcr.reader.state.v1";

export const READER_LIBRARY_STORAGE_KEY = "bcr.reader.library.v1";

export const READER_SESSION_STORAGE_KEY = "bcr.reader.session.v1";

export const READER_META_KEY = "reader/state";

export const READER_LIBRARY_META_KEY = "reader/library";

export const READER_SESSION_META_KEY = "reader/session";

export async function writeReaderValue(
  runtime: ReaderRuntime,
  metaKey: string,
  storageKey: string,
  raw: string,
  mirrorLocal: boolean,
  fallbackLocal = true,
  check: () => void = () => {},
): Promise<{ readonly local: boolean; readonly metadata: boolean }> {
  let localSaved = false;
  let metadataSaved = false;
  const writeLocal = (): void => {
    check();
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
  check();
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

export async function readerValue(
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

export function parsePersisted<T>(raw: string | undefined): T | undefined {
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}
