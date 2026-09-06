import {
  decodeCitationSource,
  findTextMatches,
  type CitationSource,
  type TextRange,
} from "./citation";
/**
 * Workspace-wide search primitives.
 *
 * The index deliberately stores lightweight projections instead of owning
 * domain state.  Readers, documents, market data and compute apps can replace
 * their own source without knowing how the shell renders or persists results.
 */

export type SearchDocumentKind =
  | "research-note"
  | "research-excerpt"
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
  readonly citation?: CitationSource | undefined;
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
  /** Original UTF-16 range in document.body. Absent for metadata-only matches. */
  readonly match?: TextRange | undefined;
}

export interface SearchPersistence {
  readonly load: () => Promise<string | undefined>;
  readonly save: (value: string) => Promise<void>;
}

export type SearchQuerySource = (
  query: string,
  signal: AbortSignal,
) => Promise<ReadonlyArray<SearchDocument>>;

export interface SearchIndex {
  /** Query-time documents remain ephemeral; owners can search large sources without retaining full text. */
  readonly registerQuerySource?: (
    source: string,
    provider: SearchQuerySource,
    ownsScope?: (scope: string) => boolean,
  ) => () => void;
  /** False means this scope is queried on demand and missing excerpts are not proof of deletion. */
  readonly isScopeIndexed?: (source: string, scope: string) => boolean;
  readonly ready: Promise<void>;
  readonly upsert: (document: SearchDocument) => void;
  readonly remove: (id: string) => void;
  readonly replaceSource: (source: string, documents: ReadonlyArray<SearchDocument>) => void;
  readonly removeSource: (source: string) => void;
  readonly search: (query: string, options?: SearchQueryOptions) => ReadonlyArray<SearchResult>;
  readonly documents: () => ReadonlyArray<SearchDocument>;
  /** Persisted projections are unverified until their owner republishes. */
  readonly isSourceLive: (source: string) => boolean;
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

function snippetFor(document: SearchDocument, range?: TextRange): string {
  const source = document.body ?? document.subtitle ?? document.title;
  let from = Math.max(0, (range?.start ?? 0) - SNIPPET_RADIUS);
  let to = Math.min(source.length, (range?.end ?? 0) + SNIPPET_RADIUS);
  if (/[\uDC00-\uDFFF]/u.test(source[from] ?? "")) from = Math.max(0, from - 1);
  if (/[\uDC00-\uDFFF]/u.test(source[to] ?? "")) to++;
  return `${from > 0 ? "…" : ""}${source.slice(from, to).replace(/\s+/gu, " ").trim()}${to < source.length ? "…" : ""}`;
}

function isSearchKind(value: unknown): value is SearchDocumentKind {
  return (
    value === "research-note" ||
    value === "research-excerpt" ||
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
    citation: decodeCitationSource(candidate.citation),
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
  private readonly querySources = new Map<
    string,
    {
      provider: SearchQuerySource;
      ownsScope?: ((scope: string) => boolean) | undefined;
      query: string;
      controller: AbortController;
      documents: readonly SearchDocument[];
    }
  >();
  registerQuerySource(
    source: string,
    provider: SearchQuerySource,
    ownsScope?: (scope: string) => boolean,
  ): () => void {
    this.querySources.get(source)?.controller.abort();
    const entry = {
      provider,
      ownsScope,
      query: "",
      controller: new AbortController(),
      documents: [] as readonly SearchDocument[],
    };
    this.querySources.set(source, entry);
    this.liveSources.add(source);
    this.notify();
    return () => {
      entry.controller.abort();
      if (this.querySources.get(source) === entry) {
        this.querySources.delete(source);
        this.notify();
      }
    };
  }
  isScopeIndexed(source: string, scope: string): boolean {
    const entry = this.querySources.get(source);
    return entry === undefined || (entry.ownsScope !== undefined && !entry.ownsScope(scope));
  }
  private queryDocuments(query: string, options: SearchQueryOptions): readonly SearchDocument[] {
    const documents: SearchDocument[] = [];
    for (const [source, entry] of this.querySources) {
      if (options.sources && !options.sources.includes(source)) continue;
      if (entry.query !== query) {
        entry.controller.abort();
        const controller = new AbortController();
        entry.controller = controller;
        entry.query = query;
        entry.documents = [];
        if (query.trim())
          void Promise.resolve()
            .then(() => entry.provider(query, controller.signal))
            .then((results) => {
              if (controller.signal.aborted) return;
              entry.documents = results.slice(0, MAX_LIMIT).flatMap((document) => {
                const decoded = decodeDocument({ ...document, source });
                if (!decoded) return [];
                this.fields.set(decoded, fieldText(decoded));
                return [decoded];
              });
              this.notify();
            })
            .catch(() => {});
      }
      documents.push(...entry.documents);
    }
    return documents;
  }
  private readonly entries = new Map<string, SearchDocument>();
  private readonly fields = new WeakMap<SearchDocument, ReturnType<typeof fieldText>>();

  private setDocument(document: SearchDocument): void {
    this.fields.set(document, fieldText(document));
    this.entries.set(document.id, document);
  }
  private readonly liveSources = new Set<string>();
  isSourceLive = (source: string): boolean => this.liveSources.has(source);
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
        this.setDocument(document);
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
    this.setDocument(normalizedDocument);
    this.schedulePersist();
    this.notify();
  }

  remove(id: string): void {
    if (!this.entries.delete(id)) return;
    this.schedulePersist();
    this.notify();
  }

  replaceSource(source: string, documents: ReadonlyArray<SearchDocument>): void {
    this.liveSources.add(source);
    for (const [id, document] of this.entries) {
      if (document.source === source) this.entries.delete(id);
    }
    for (const document of documents) {
      const decoded = decodeDocument({ ...document, source });
      if (decoded !== undefined) this.setDocument(decoded);
    }
    this.schedulePersist();
    this.notify();
  }

  removeSource(source: string): void {
    this.liveSources.add(source);
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
    const phrase = normalized(query);
    const terms = queryTerms(phrase);
    const queryDocuments = this.queryDocuments(query, options);
    if (terms.length === 0) return [];
    const kinds = options.kinds === undefined ? undefined : new Set(options.kinds);
    const sources = options.sources === undefined ? undefined : new Set(options.sources);
    const requestedLimit = options.limit ?? DEFAULT_LIMIT;
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, Math.floor(Number.isNaN(requestedLimit) ? DEFAULT_LIMIT : requestedLimit)),
    );
    // Every eligible document emits at least one result; documents below the top
    // limit can never contribute to the final page, even with repeated citations.
    const candidates: Array<{ document: SearchDocument; score: number }> = [];
    const compare = (
      left: { document: SearchDocument; score: number },
      right: { document: SearchDocument; score: number },
    ) =>
      right.score - left.score ||
      right.document.updatedAt - left.document.updatedAt ||
      left.document.title.localeCompare(right.document.title);
    for (const document of [...this.entries.values(), ...queryDocuments]) {
      if (kinds !== undefined && !kinds.has(document.kind)) continue;
      if (sources !== undefined && !sources.has(document.source)) continue;
      const fields = this.fields.get(document)!;
      if (!terms.every((term) => fields.all.includes(term))) continue;
      const matchedTerms = terms;
      const titleMatches = matchedTerms.reduce(
        (total, term) => total + occurrenceCount(fields.title, term),
        0,
      );
      const bodyMatches = matchedTerms.reduce(
        (total, term) => total + occurrenceCount(fields.rest, term),
        0,
      );
      const exactPhrase = fields.all.includes(phrase);
      const exactTitle = fields.title === phrase;
      const titleStart = matchedTerms.some((term) => fields.title.startsWith(term));
      const score =
        (exactTitle ? 180 : 0) +
        (exactPhrase ? 48 : 0) +
        (titleStart ? 24 : 0) +
        titleMatches * 18 +
        Math.min(36, bodyMatches * 4) +
        matchedTerms.length * 8;
      const candidate = { document, score };
      if (candidates.length === limit && compare(candidate, candidates[limit - 1]!) >= 0) continue;
      // Insert after equal-ranked documents to preserve the original stable order.
      let low = 0,
        high = candidates.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (compare(candidate, candidates[middle]!) < 0) high = middle;
        else low = middle + 1;
      }
      candidates.splice(low, 0, candidate);
      if (candidates.length > limit) candidates.pop();
    }
    const results: SearchResult[] = [];
    for (const { document, score } of candidates) {
      const matchedTerms = terms;
      const phraseMatches = document.body ? findTextMatches(document.body, query, limit) : [];
      const ranges = phraseMatches.length
        ? phraseMatches
        : matchedTerms.flatMap((term) =>
            document.body ? findTextMatches(document.body, term, limit) : [],
          );
      const unique = [
        ...new Map(ranges.map((range) => [`${range.start}:${range.end}`, range])).values(),
      ].sort((left, right) => left.start - right.start);
      // Preserve the existing one-result semantics for metadata/application entries.
      for (const match of document.citation && unique.length
        ? unique.slice(0, limit)
        : [unique[0]]) {
        results.push({
          document,
          score,
          snippet: snippetFor(document, match),
          matchedTerms,
          ...(match ? { match } : {}),
        });
        if (results.length === limit) return results;
      }
    }
    return results;
  }

  documents(): ReadonlyArray<SearchDocument> {
    return [
      ...this.entries.values(),
      ...[...this.querySources.values()].flatMap((entry) => entry.documents),
    ].sort(
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
    const payload: PersistedSearchIndex = { version: 1, documents: [...this.entries.values()] };
    const raw = JSON.stringify(payload);
    const persistence = this.persistence;
    this.persistTail = this.persistTail.catch(() => undefined).then(() => persistence.save(raw));
    await this.persistTail;
  }

  async close(): Promise<void> {
    for (const entry of this.querySources.values()) entry.controller.abort();
    this.querySources.clear();
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
