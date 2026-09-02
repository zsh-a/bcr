/**
 * Reader domain objects are deliberately format-agnostic. Adapters translate
 * EPUB/PDF/CBZ/text sources into this small model; the UI never branches on
 * parser internals when it restores progress or searches a publication.
 */

export type ReaderFormat =
  | "txt"
  | "markdown"
  | "html"
  | "docx"
  | "epub"
  | "pdf"
  | "cbz"
  | "cbr"
  | "fb2"
  | "mobi"
  | "azw3"
  | "unknown";

export type ReaderSectionKind = "text" | "image" | "pdf-page";

export interface ReaderSourceRef {
  readonly id: string;
  readonly hash: string;
  readonly storage: "opfs" | "memory";
  readonly mime: string;
  readonly size: number;
}

export interface ReaderSource {
  readonly name: string;
  readonly format: ReaderFormat;
  readonly mime: string;
  readonly size: number;
  readonly ref?: ReaderSourceRef | undefined;
  /** Ephemeral URL used by image/PDF adapters. It is rebuilt on restore. */
  readonly objectUrl?: string | undefined;
}

export interface ReaderSection {
  readonly id: string;
  readonly order: number;
  readonly label: string;
  readonly kind: ReaderSectionKind;
  readonly text: string;
  readonly html?: string | undefined;
  readonly imageUrl?: string | undefined;
  readonly imageAlt?: string | undefined;
  readonly pageNumber?: number | undefined;
  readonly href?: string | undefined;
}

/** A publication-provided navigation entry (EPUB nav/NCX or a future format). */
export interface ReaderTocItem {
  readonly id: string;
  readonly label: string;
  /** Resolved section identity; absent for an external/unavailable target. */
  readonly sectionId?: string | undefined;
  /** Normalized archive href kept for Locator migration and diagnostics. */
  readonly href?: string | undefined;
  readonly children?: ReadonlyArray<ReaderTocItem> | undefined;
}

export interface ReaderBook {
  readonly id: string;
  readonly title: string;
  readonly author?: string | undefined;
  readonly language?: string | undefined;
  readonly coverUrl?: string | undefined;
  readonly source: ReaderSource;
  readonly sections: ReadonlyArray<ReaderSection>;
  readonly toc?: ReadonlyArray<ReaderTocItem> | undefined;
  readonly importedAt: number;
  readonly updatedAt: number;
  readonly tags: ReadonlyArray<string>;
}

export type LocatorKind = "section" | "page" | "image";

/** TextQuote/TextPosition style anchor for reflow-safe reading positions. */
export interface ReaderTextAnchor {
  readonly exact: string;
  readonly prefix?: string | undefined;
  readonly suffix?: string | undefined;
  readonly start?: number | undefined;
  readonly end?: number | undefined;
}

export interface ReaderLocator {
  readonly kind: LocatorKind;
  readonly sectionId: string;
  readonly progression: number;
  readonly pageNumber?: number | undefined;
  readonly href?: string | undefined;
  readonly textAnchor?: ReaderTextAnchor | undefined;
}

export interface ReaderProgress {
  readonly locator: ReaderLocator;
  readonly percentage: number;
  readonly updatedAt: number;
}

/** A user-owned semantic position that survives reflow and format restoration. */
export interface ReaderBookmark {
  readonly id: string;
  readonly label: string;
  readonly locator: ReaderLocator;
  readonly createdAt: number;
}

/** A short user note anchored to the same semantic position as a bookmark. */
export interface ReaderAnnotation {
  readonly id: string;
  readonly label: string;
  readonly note: string;
  readonly locator: ReaderLocator;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface SearchHit {
  readonly bookId: string;
  readonly sectionId: string;
  readonly label: string;
  readonly snippet: string;
  readonly score: number;
  readonly matchStart: number;
  readonly matchLength: number;
}
