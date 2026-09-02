export type {
  LocatorKind,
  ReaderBook,
  ReaderFormat,
  ReaderLocator,
  ReaderProgress,
  ReaderSection,
  ReaderSectionKind,
  ReaderSource,
  ReaderSourceRef,
  SearchHit,
} from "./model";
export {
  clampProgression,
  createLocator,
  firstLocator,
  locatorAtPercentage,
  normalizeLocator,
  percentageForLocator,
  progressForLocator,
} from "./locator";
export {
  buildSearchIndex,
  makeSnippet,
  normalizeSearchQuery,
  searchBook,
  searchIndexedDocuments,
  searchLibrary,
  type ReaderIndexBook,
  type ReaderIndexDocument,
} from "./search";
export { adapterFor, type ReaderAdapter, type ReaderOpenInput } from "./adapter";
