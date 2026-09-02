/**
 * Workspace-wide search primitives.
 *
 * The index deliberately stores lightweight projections instead of owning
 * domain state.  Readers, documents, market data and compute apps can replace
 * their own source without knowing how the shell renders or persists results.
 */

export type SearchDocumentKind =
  | "app"
  | "file"
  | "task"
  | "reader-book"
  | "reader-section"
  | "document"
  | "manga-page"
  | "manga-region"
  | "media"
  | "dataset"
  | "market-instrument";

export interface SearchDocument {
  readonly id: string;
  readonly source: string;
  readonly kind: SearchDocumentKind;
  readonly title: string;
  readonly subtitle?: string | undefined;
  readonly body?: string | undefined;
  readonly tags?: ReadonlyArray<string> | undefined;
  /** A shell route that can reopen the owning app and selection. */
  readonly route?: string | undefined;
  readonly updatedAt: number;
}

export interface SearchQueryOptions {
  readonly limit?: number | undefined;
  readonly kinds?: ReadonlyArray<SearchDocumentKind> | undefined;
  readonly sources?: ReadonlyArray<string> | undefined;
}

export interface SearchResult {
  readonly document: SearchDocument;
  readonly score: number;
  readonly snippet: string;
  readonly matchedTerms: ReadonlyArray<string>;
}

export interface SearchPersistence {
  readonly load: () => Promise<string | undefined>;
  readonly save: (value: string) => Promise<void>;
}

export interface SearchIndex {
  readonly ready: Promise<void>;
  readonly upsert: (document: SearchDocument) => void;
  readonly remove: (id: string) => void;
  readonly replaceSource: (source: string, documents: ReadonlyArray<SearchDocument>) => void;
  readonly removeSource: (source: string) => void;
  readonly search: (query: string, options?: SearchQueryOptions) => ReadonlyArray<SearchResult>;
  readonly documents: () => ReadonlyArray<SearchDocument>;
  readonly subscribe: (listener: () => void) => () => void;
  readonly flush: () => Promise<void>;
  readonly close: () => Promise<void>;
}

interface PersistedSearchIndex {
  readonly version: 1;
  readonly documents: ReadonlyArray<SearchDocument>;
}

const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 200;
const SNIPPET_RADIUS = 74;

function normalized(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/gu, " ").trim();
}

function queryTerms(query: string): ReadonlyArray<string> {
  const value = normalized(query);
  return value.length === 0
    ? []
    : [
        ...new Set(
          value
            .split(" ")
            .map((term) => term.trim())
            .filter(Boolean),
        ),
      ];
}

function fieldText(document: SearchDocument): {
  readonly title: string;
  readonly rest: string;
  readonly all: string;
} {
  const title = normalized(document.title);
  const rest = normalized(
    [document.subtitle ?? "", document.body ?? "", ...(document.tags ?? [])].join(" "),
  );
  return { title, rest, all: `${title} ${rest}`.trim() };
}

function occurrenceCount(value: string, term: string): number {
  if (term.length === 0) return 0;
  let count = 0;
  let from = 0;
  while (from < value.length) {
    const index = value.indexOf(term, from);
    if (index < 0) break;
    count += 1;
    from = index + Math.max(1, term.length);
  }
  return count;
}

function snippetFor(document: SearchDocument, terms: ReadonlyArray<string>): string {
  const source = (document.body ?? document.subtitle ?? document.title)
    .replace(/\s+/gu, " ")
    .trim();
  if (source.length <= SNIPPET_RADIUS * 2 + 1) return source;
  const lower = normalized(source);
  const start = terms
    .map((term) => lower.indexOf(term))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];
  const center = start ?? 0;
  const from = Math.max(0, center - SNIPPET_RADIUS);
  const to = Math.min(source.length, center + SNIPPET_RADIUS);
  return `${from > 0 ? "…" : ""}${source.slice(from, to).trim()}${to < source.length ? "…" : ""}`;
}

function isSearchKind(value: unknown): value is SearchDocumentKind {
  return (
    value === "app" ||
    value === "file" ||
    value === "task" ||
    value === "reader-book" ||
    value === "reader-section" ||
    value === "document" ||
    value === "manga-page" ||
    value === "manga-region" ||
    value === "media" ||
    value === "dataset" ||
    value === "market-instrument"
  );
}

function decodeDocument(value: unknown): SearchDocument | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Partial<SearchDocument>;
  if (
    typeof candidate.id !== "string" ||
    candidate.id.length === 0 ||
    typeof candidate.source !== "string" ||
    candidate.source.length === 0 ||
    !isSearchKind(candidate.kind) ||
    typeof candidate.title !== "string" ||
    candidate.title.length === 0 ||
    typeof candidate.updatedAt !== "number" ||
    !Number.isFinite(candidate.updatedAt)
  ) {
    return undefined;
  }
  const subtitle = typeof candidate.subtitle === "string" ? candidate.subtitle : undefined;
  const body = typeof candidate.body === "string" ? candidate.body : undefined;
  const tags = Array.isArray(candidate.tags)
    ? candidate.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 24)
    : undefined;
  const route = typeof candidate.route === "string" ? candidate.route : undefined;
  return {
    id: candidate.id,
    source: candidate.source,
    kind: candidate.kind,
    title: candidate.title,
    ...(subtitle === undefined ? {} : { subtitle }),
    ...(body === undefined ? {} : { body: body.slice(0, 24_000) }),
    ...(tags === undefined ? {} : { tags }),
    ...(route === undefined ? {} : { route }),
    updatedAt: candidate.updatedAt,
  };
}

function decodePersisted(value: string | undefined): ReadonlyArray<SearchDocument> {
  if (value === undefined) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null) return [];
    const candidate = parsed as { version?: unknown; documents?: unknown };
    if (candidate.version !== 1 || !Array.isArray(candidate.documents)) return [];
    const seen = new Set<string>();
    return candidate.documents.flatMap((item) => {
      const document = decodeDocument(item);
      if (document === undefined || seen.has(document.id)) return [];
      seen.add(document.id);
      return [document];
    });
  } catch {
    return [];
  }
}

class MemorySearchIndex implements SearchIndex {
  readonly ready: Promise<void>;
  private readonly entries = new Map<string, SearchDocument>();
  private readonly listeners = new Set<() => void>();
  private readonly persistence: SearchPersistence | undefined;
  private persistTimer: ReturnType<typeof setTimeout> | undefined;
  private persistTail: Promise<void> = Promise.resolve();

  constructor(persistence?: SearchPersistence) {
    this.persistence = persistence;
    this.ready = this.restore();
  }

  private async restore(): Promise<void> {
    if (this.persistence === undefined) return;
    try {
      for (const document of decodePersisted(await this.persistence.load())) {
        this.entries.set(document.id, document);
      }
      this.notify();
    } catch {
      // Search is an enhancement; malformed/unavailable metadata never blocks boot.
    }
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // Observers must not break index writes.
      }
    }
  }

  private schedulePersist(): void {
    if (this.persistence === undefined) return;
    if (this.persistTimer !== undefined) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = undefined;
      void this.flush();
    }, 350);
  }

  upsert(document: SearchDocument): void {
    const normalizedDocument = decodeDocument(document);
    if (normalizedDocument === undefined) return;
    this.entries.set(normalizedDocument.id, normalizedDocument);
    this.schedulePersist();
    this.notify();
  }

  remove(id: string): void {
    if (!this.entries.delete(id)) return;
    this.schedulePersist();
    this.notify();
  }

  replaceSource(source: string, documents: ReadonlyArray<SearchDocument>): void {
    for (const [id, document] of this.entries) {
      if (document.source === source) this.entries.delete(id);
    }
    for (const document of documents) {
      if (document.source === source) this.upsert(document);
      else this.upsert({ ...document, source });
    }
    this.schedulePersist();
    this.notify();
  }

  removeSource(source: string): void {
    let changed = false;
    for (const [id, document] of this.entries) {
      if (document.source === source) {
        this.entries.delete(id);
        changed = true;
      }
    }
    if (!changed) return;
    this.schedulePersist();
    this.notify();
  }

  search(query: string, options: SearchQueryOptions = {}): ReadonlyArray<SearchResult> {
    const terms = queryTerms(query);
    if (terms.length === 0) return [];
    const kinds = options.kinds === undefined ? undefined : new Set(options.kinds);
    const sources = options.sources === undefined ? undefined : new Set(options.sources);
    const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(options.limit ?? DEFAULT_LIMIT)));
    const results: SearchResult[] = [];
    for (const document of this.entries.values()) {
      if (kinds !== undefined && !kinds.has(document.kind)) continue;
      if (sources !== undefined && !sources.has(document.source)) continue;
      const fields = fieldText(document);
      const matchedTerms = terms.filter((term) => fields.all.includes(term));
      if (matchedTerms.length !== terms.length) continue;
      const titleMatches = matchedTerms.reduce(
        (total, term) => total + occurrenceCount(fields.title, term),
        0,
      );
      const bodyMatches = matchedTerms.reduce(
        (total, term) => total + occurrenceCount(fields.rest, term),
        0,
      );
      const exactPhrase = normalized(query).length > 0 && fields.all.includes(normalized(query));
      const exactTitle = fields.title === normalized(query);
      const titleStart = matchedTerms.some((term) => fields.title.startsWith(term));
      const score =
        (exactTitle ? 180 : 0) +
        (exactPhrase ? 48 : 0) +
        (titleStart ? 24 : 0) +
        titleMatches * 18 +
        Math.min(36, bodyMatches * 4) +
        matchedTerms.length * 8;
      results.push({
        document,
        score,
        snippet: snippetFor(document, matchedTerms),
        matchedTerms,
      });
    }
    return results
      .sort(
        (left, right) =>
          right.score - left.score ||
          right.document.updatedAt - left.document.updatedAt ||
          left.document.title.localeCompare(right.document.title),
      )
      .slice(0, limit);
  }

  documents(): ReadonlyArray<SearchDocument> {
    return [...this.entries.values()].sort(
      (left, right) => right.updatedAt - left.updatedAt || left.title.localeCompare(right.title),
    );
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async flush(): Promise<void> {
    if (this.persistence === undefined) return;
    await this.ready;
    const payload: PersistedSearchIndex = { version: 1, documents: this.documents() };
    const raw = JSON.stringify(payload);
    const persistence = this.persistence;
    this.persistTail = this.persistTail.catch(() => undefined).then(() => persistence.save(raw));
    await this.persistTail;
  }

  async close(): Promise<void> {
    if (this.persistTimer !== undefined) {
      clearTimeout(this.persistTimer);
      this.persistTimer = undefined;
    }
    await this.flush();
  }
}

export function createSearchIndex(persistence?: SearchPersistence): SearchIndex {
  return new MemorySearchIndex(persistence);
}
