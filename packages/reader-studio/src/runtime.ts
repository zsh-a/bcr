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
} from "./runtime/readerRuntimeCore";
export {
  importReaderContentPackage,
  importReaderDocumentHandoff,
  importReaderExportBundle,
  importReaderFile,
  prepareReaderDocumentHandoff,
  type ReaderDocumentHandoffPayload,
} from "./library/readerImports";
export {
  mirrorReaderLibrary,
  mirrorReaderSession,
  persistReader,
} from "./persistence/readerPersistence";
export { restoreReader, restoreReaderBooks } from "./persistence/restore";
export {
  type PersistReaderOptions,
  type ReaderBookRestoreBatch,
  type ReaderRestoreDiagnostics,
  type ReaderRestoreIssue,
} from "./persistence/model";
export {
  indexBook,
  searchIndexed,
  searchIndexedDetailed,
  type ReaderSearchResult,
} from "./search/readerSearch";
