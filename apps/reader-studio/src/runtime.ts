/**
 * Public Reader runtime facade.
 *
 * Lifecycle, import/handoff, persistence/recovery, and search are implemented
 * in separate modules so consumers keep one stable API without a monolithic
 * runtime implementation.
 */
export {
  createReaderRuntime,
  ensureReaderMetadata,
  readerRuntime,
  type ReaderRuntime,
} from "./readerRuntimeCore";
export {
  importReaderContentPackage,
  importReaderDocumentHandoff,
  importReaderExportBundle,
  importReaderFile,
  prepareReaderDocumentHandoff,
  type ReaderDocumentHandoffPayload,
} from "./readerImports";
export {
  mirrorReaderLibrary,
  mirrorReaderSession,
  persistReader,
  restoreReader,
  restoreReaderBooks,
  type PersistReaderOptions,
  type ReaderBookRestoreBatch,
  type ReaderRestoreDiagnostics,
  type ReaderRestoreIssue,
} from "./readerPersistence";
export {
  indexBook,
  searchIndexed,
  searchIndexedDetailed,
  type ReaderSearchResult,
} from "./readerSearch";
