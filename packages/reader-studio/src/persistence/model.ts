import { type ReaderBook } from "@bcr/reader-core";
import { type ReaderSearchSession, type ReaderSettings, type ReaderState } from "../state/model";

export interface PersistReaderOptions {
  /** Set false when the caller has already mirrored the latest session synchronously. */
  readonly mirrorSession?: boolean;
  readonly forceLibrary?: boolean;
  /** Recheck the live snapshot after asynchronous writes and before local mirrors. */
  readonly assertCurrent?: () => void;
}

export interface PersistedBook {
  readonly favorite?: boolean | undefined;
  readonly rendition?: ReaderBook["rendition"];
  readonly preserveSectionSnapshot?: boolean;
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
    readonly contentInfo?: ReaderBook["sections"][number]["contentInfo"];
    readonly textRange?: ReaderBook["sections"][number]["textRange"];
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

export interface PersistedReaderSnapshot {
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

export interface PersistedReaderLibrary {
  readonly version: 1;
  readonly books: ReadonlyArray<PersistedBook>;
}

export interface PersistedReaderSession {
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

/** Durable restore projection returned by {@link restoreReader}. */
export interface RestoredReaderSnapshot {
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

export interface RestoredBookResult {
  readonly book?: ReaderBook | undefined;
  readonly issue?: ReaderRestoreIssue | undefined;
}
