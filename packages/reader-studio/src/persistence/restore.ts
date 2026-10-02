import { inlineTxtToc } from "../content/txtChapters";
import { restoreStructuredContent } from "../content/structuredContent";
import { attachTxtSections, openLazyTxt, LAZY_TXT_MIN_BYTES } from "../content/lazyTxt";
import {
  hasDeferredContent,
  releaseReaderContent,
  attachDeferredSource,
} from "../content/readerContent";
import { validTxtRanges } from "../content/txtIndex";
import { artifactPath, type ArtifactRef } from "@bcr/core";
import { Effect } from "effect";
import { type ReaderBook } from "@bcr/reader-core";
import { DEFAULT_READER_SETTINGS, normalizeBookSettings } from "../state/model";
import { normalizeReaderProgress } from "../state/session-contract";
import { normalizeReaderTypography } from "../typography/readerTypography";
import { parseReaderFile } from "../library/readerImports";
import type { ReaderRuntime } from "../runtime/readerRuntimeCore";
import {
  type PersistedBook,
  type ReaderRestoreIssue,
  type RestoredBookResult,
  type RestoredReaderSnapshot,
  type PersistedReaderSnapshot,
  type PersistedReaderLibrary,
  type PersistedReaderSession,
  type ReaderBookRestoreBatch,
} from "./model";
import {
  readerValue,
  READER_META_KEY,
  READER_STORAGE_KEY,
  READER_LIBRARY_META_KEY,
  READER_LIBRARY_STORAGE_KEY,
  READER_SESSION_META_KEY,
  READER_SESSION_STORAGE_KEY,
  parsePersisted,
} from "./storage";
import {
  readerLibrarySignature,
  restoreNavigationHistory,
  restoredBookmarks,
  restoredAnnotations,
  restoredSearchSession,
} from "./codec";

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
  const sourceBlob = await Effect.runPromise(runtime.artifacts.getBlob(artifactRef));
  return new File([sourceBlob], book.source.name, { type: book.source.mime });
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

/** Keep citation identities/text while rebuilding transient binary resources. */
export function restoreSectionSnapshots(
  parsed: ReaderBook,
  snapshot: Pick<PersistedBook, "sections">,
): ReaderBook["sections"] {
  if (
    parsed.sections.length !== snapshot.sections.length ||
    parsed.sections.some((section, i) => section.kind !== snapshot.sections[i]?.kind)
  )
    throw new Error("源文件解析结构与资料包快照不一致");
  if (
    hasDeferredContent(parsed) &&
    snapshot.sections.every((section) => section.textRange || section.contentInfo)
  ) {
    if (parsed.sections.some((section, i) => section.id !== snapshot.sections[i]?.id))
      throw new Error("源文件章节标识与资料包快照不一致");
    return parsed.sections;
  }
  // Legacy packages retain their exact text; they do not inherit deferred bindings.
  releaseReaderContent(parsed);
  return snapshot.sections.map((section, i) => {
    const fresh = parsed.sections[i]!;
    return {
      ...fresh,
      contentInfo: undefined,
      textRange: undefined,
      ...section,
      // Saved Blob URLs belong to the exporting browser. Use freshly parsed
      // markup only when its text agrees; otherwise render the saved text.
      html: fresh.text === section.text ? fresh.html : undefined,
    };
  });
}

async function restoreBook(
  runtime: ReaderRuntime,
  persisted: PersistedBook,
  signal?: AbortSignal,
): Promise<RestoredBookResult> {
  if (persisted.sections.some((section) => section.contentInfo?.storageRange)) {
    try {
      const projected = projectPersistedBook(persisted);
      if (!projected.book) return projected;
      const cached = await restoreStructuredContent(runtime, projected.book);
      if (cached) return { book: cached };
      const file = await fileFromSource(runtime, persisted);
      if (!file) throw new Error("正文源文件不可用");
      const rebuilt = await parseReaderFile(runtime, file, persisted.id, signal);
      return { book: { ...projected.book, sections: rebuilt.sections } };
    } catch (reason) {
      return { issue: restoreIssue(persisted, reason) };
    }
  }
  if (
    persisted.source.format === "txt" &&
    (persisted.sections.some((section) => section.textRange) ||
      (!persisted.preserveSectionSnapshot &&
        persisted.source.ref &&
        persisted.source.size >= LAZY_TXT_MIN_BYTES))
  ) {
    try {
      const file = await fileFromSource(runtime, persisted);
      if (!file) throw new Error("TXT 源文件不可用");
      const projected = projectPersistedBook(persisted);
      if (!projected.book) return projected;
      const reusable =
        validTxtRanges(persisted.sections, file.size) &&
        (persisted.toc !== undefined || persisted.preserveSectionSnapshot);
      const opened = reusable
        ? undefined
        : await openLazyTxt({
            file,
            id: persisted.id,
            format: "txt",
            ...(signal ? { signal } : {}),
          });
      return {
        book: {
          ...projected.book,
          sections:
            opened?.sections ??
            attachTxtSections(
              file,
              persisted.sections.map((section) => section.textRange!),
            ),
          ...(opened && !persisted.preserveSectionSnapshot ? { toc: opened.toc } : {}),
        },
      };
    } catch (reason) {
      return { issue: restoreIssue(persisted, reason) };
    }
  }
  if (isBinaryBook(persisted) && persisted.source.ref !== undefined) {
    try {
      const file = await fileFromSource(runtime, persisted);
      if (file !== undefined) {
        const reopened = await parseReaderFile(runtime, file, persisted.id, signal);
        return {
          book: {
            ...reopened,
            ...(persisted.preserveSectionSnapshot
              ? {
                  preserveSectionSnapshot: true,
                  sections: restoreSectionSnapshots(reopened, persisted),
                }
              : {}),
            title: persisted.title,
            ...(typeof persisted.favorite === "boolean" ? { favorite: persisted.favorite } : {}),
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
        ...(persisted.preserveSectionSnapshot ? { preserveSectionSnapshot: true } : {}),
        ...(persisted.rendition === undefined ? {} : { rendition: persisted.rendition }),
        id: persisted.id,
        title: persisted.title,
        ...(typeof persisted.favorite === "boolean" ? { favorite: persisted.favorite } : {}),
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
        ...(persisted.toc !== undefined
          ? { toc: persisted.toc }
          : persisted.source.format === "txt" && !persisted.preserveSectionSnapshot
            ? { toc: inlineTxtToc(persisted.sections) }
            : {}),
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
      ? await Promise.all(
          persistedBooks.map(async (persisted, index) => ({
            index,
            book:
              persisted.source.format === "txt" ||
              persisted.sections.some((section) => section.contentInfo?.storageRange)
                ? await restoreBook(runtime, persisted)
                : projectDeferredBook(runtime, persisted),
          })),
        )
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
      settings: {
        ...DEFAULT_READER_SETTINGS,
        ...normalizeReaderTypography({ ...DEFAULT_READER_SETTINGS, ...source?.settings }),
        books: normalizeBookSettings(source?.settings?.books),
      },
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
            .filter(
              (persisted) =>
                isBinaryBook(persisted) &&
                persisted.source.ref !== undefined &&
                !persisted.sections.some((section) => section.contentInfo?.storageRange),
            )
            .map((persisted) => persisted.id)
        : [],
    };
  } catch {
    return undefined;
  }
}

function projectDeferredBook(runtime: ReaderRuntime, persisted: PersistedBook): RestoredBookResult {
  const projected = projectPersistedBook(persisted);
  if (!projected.book || !hasDeferredContent(projected.book)) return projected;
  return {
    book: {
      ...projected.book,
      sections: attachDeferredSource(projected.book.sections, async (signal) => {
        const result = await restoreBook(runtime, persisted, signal);
        if (!result.book) throw new Error(result.issue?.reason ?? "正文源不可用");
        return result.book;
      }),
    },
  };
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
