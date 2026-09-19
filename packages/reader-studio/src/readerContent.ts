import { textVersion } from "@bcr/core";
import {
  makeSnippet,
  normalizeSearchQuery,
  searchTextRanges,
  type ReaderBook,
  type ReaderSection,
  type SearchHit,
} from "@bcr/reader-core";

export interface SectionContent {
  readonly text: string;
  readonly html?: string | undefined;
  readonly imageUrl?: string | undefined;
  readonly images?: readonly string[] | undefined;
  /** Includes decoded resources when known. */
  readonly bytes?: number;
  readonly dispose?: () => void;
}
export interface ContentSearchHit extends SearchHit {
  readonly excerpt: string;
  readonly excerptStart: number;
  readonly version: string;
}
export interface ReaderContentProvider {
  read(index: number, signal: AbortSignal, purpose: "display" | "text"): Promise<SectionContent>;
  search?(bookId: string, query: string, signal?: AbortSignal): Promise<ContentSearchHit[]>;
  dispose?(): void;
  readonly budget?: { readonly bytes: number; readonly entries: number };
}
interface PendingRead {
  controller: AbortController;
  promise: Promise<void>;
}

/** A publication owns one cache. Subscribers pin visible content; eviction releases resources. */
class ContentSession {
  readonly cache = new Map<number, SectionContent>();
  readonly pending = new Map<number, PendingRead>();
  readonly listeners = new Map<number, Set<() => void>>();
  private bytes = 0;
  private disposed = false;
  constructor(readonly provider: ReaderContentProvider) {}
  assertOpen() {
    if (this.disposed) throw new Error("出版物已关闭");
  }
  async read(index: number, signal: AbortSignal, purpose: "display" | "text") {
    this.assertOpen();
    signal.throwIfAborted();
    const value = await this.provider.read(index, signal, purpose);
    if (this.disposed || signal.aborted) {
      value.dispose?.();
      signal.throwIfAborted();
      this.assertOpen();
    }
    return value;
  }
  private cost(value: SectionContent) {
    return value.bytes ?? (value.text.length + (value.html?.length ?? 0)) * 2;
  }
  private remove(index: number, value: SectionContent) {
    this.cache.delete(index);
    this.bytes -= this.cost(value);
    value.dispose?.();
  }
  private trim() {
    const budget = this.provider.budget ?? { bytes: 4 * 1024 * 1024, entries: 128 };
    for (const [index, value] of this.cache) {
      if (this.bytes <= budget.bytes && this.cache.size <= budget.entries) break;
      if (!this.listeners.has(index)) this.remove(index, value);
    }
  }
  subscribe(index: number, listener: () => void): () => void {
    // A distinct registration also supports subscribing the same callback twice.
    const notify = () => listener();
    const listeners = this.listeners.get(index) ?? new Set();
    listeners.add(notify);
    this.listeners.set(index, listeners);
    return () => {
      if (!listeners.delete(notify)) return;
      if (!listeners.size) {
        this.listeners.delete(index);
        this.pending.get(index)?.controller.abort();
        this.pending.delete(index);
      }
      if (this.listeners.size) {
        this.trim();
        return;
      }
      for (const pending of this.pending.values()) pending.controller.abort();
      this.pending.clear();
      for (const [key, value] of this.cache) this.remove(key, value);
    };
  }
  load(index: number): Promise<void> {
    if (this.disposed) return Promise.reject(new Error("出版物已关闭"));
    const cached = this.cache.get(index);
    if (cached) {
      this.cache.delete(index);
      this.cache.set(index, cached);
      return Promise.resolve();
    }
    const previous = this.pending.get(index);
    if (previous) return previous.promise;
    const controller = new AbortController();
    const request: PendingRead = { controller, promise: Promise.resolve() };
    request.promise = this.read(index, controller.signal, "display")
      .then((value) => {
        if (controller.signal.aborted || this.disposed) {
          value.dispose?.();
          controller.signal.throwIfAborted();
          return;
        }
        this.cache.set(index, value);
        this.bytes += this.cost(value);
        this.trim();
        for (const listener of this.listeners.get(index) ?? []) listener();
      })
      .finally(() => {
        if (this.pending.get(index) === request) this.pending.delete(index);
      });
    this.pending.set(index, request);
    return request.promise;
  }
  close() {
    if (this.disposed) return;
    this.disposed = true;
    for (const pending of this.pending.values()) pending.controller.abort();
    this.pending.clear();
    for (const [index, value] of this.cache) this.remove(index, value);
    this.provider.dispose?.();
  }
}
const bindings = new WeakMap<ReaderSection, { session: ContentSession; index: number }>();

export function attachReaderContent(
  sections: readonly ReaderSection[],
  provider: ReaderContentProvider,
): readonly ReaderSection[] {
  const session = new ContentSession(provider);
  return sections.map((metadata, index) => {
    const section: ReaderSection = {
      ...metadata,
      get text() {
        return session.cache.get(index)?.text ?? "";
      },
      get html() {
        return session.cache.get(index)?.html;
      },
      get imageUrl() {
        return session.cache.get(index)?.imageUrl;
      },
    };
    bindings.set(section, { session, index });
    return section;
  });
}
export function hasDeferredContent(book: ReaderBook): boolean {
  return book.sections.some(
    (section) => section.contentInfo !== undefined || section.textRange !== undefined,
  );
}
export function sectionContentReady(section: ReaderSection | undefined): boolean {
  if (!section) return true;
  const binding = bindings.get(section);
  return binding
    ? binding.session.cache.has(binding.index)
    : !section.contentInfo && !section.textRange;
}
export function loadSectionContent(section: ReaderSection): Promise<void> {
  const binding = bindings.get(section);
  if (binding) return binding.session.load(binding.index);
  return sectionContentReady(section)
    ? Promise.resolve()
    : Promise.reject(new Error("正文源尚未就绪"));
}
export function subscribeSectionContent(
  section: ReaderSection | undefined,
  listener: () => void,
): () => void {
  const binding = section && bindings.get(section);
  return binding ? binding.session.subscribe(binding.index, listener) : () => {};
}
export function releaseReaderContent(book: ReaderBook): void {
  const sessions = new Set(
    book.sections.flatMap((section) => {
      const binding = bindings.get(section);
      return binding ? [binding.session] : [];
    }),
  );
  for (const session of sessions) session.close();
}
export function sectionImages(section: ReaderSection): readonly string[] {
  const binding = bindings.get(section);
  const content = binding?.session.cache.get(binding.index);
  if (content?.images) return content.images;
  if (section.imageUrl) return [section.imageUrl];
  return [];
}
export async function readSectionContent(
  section: ReaderSection,
  signal = new AbortController().signal,
  purpose: "display" | "text" = "text",
): Promise<SectionContent> {
  signal.throwIfAborted();
  const binding = bindings.get(section);
  if (!binding) {
    if (!sectionContentReady(section)) throw new Error("正文源尚未就绪");
    return { text: section.text, html: section.html, imageUrl: section.imageUrl };
  }
  return binding.session.read(binding.index, signal, purpose);
}
export async function searchReaderContent(
  book: ReaderBook,
  query: string,
  signal?: AbortSignal,
): Promise<ContentSearchHit[]> {
  signal?.throwIfAborted();
  if (!normalizeSearchQuery(query)) return [];
  const binding = book.sections[0] && bindings.get(book.sections[0]);
  binding?.session.assertOpen();
  if (binding?.session.provider.search)
    return binding.session.provider.search(book.id, query, signal);
  const hits: ContentSearchHit[] = [];
  for (const section of book.sections) {
    const content = await readSectionContent(section, signal);
    try {
      const ranges = searchTextRanges(content.text, query, 80 - hits.length);
      const version = ranges.length ? textVersion(content.text) : "";
      for (const range of ranges) {
        const excerptStart = Math.max(0, range.start - 80);
        hits.push({
          bookId: book.id,
          sectionId: section.id,
          label: section.label,
          score: 1,
          matchStart: range.start,
          matchLength: range.length,
          snippet: makeSnippet(content.text, range.start, range.length),
          excerpt: content.text.slice(excerptStart, range.start + range.length + 80),
          excerptStart,
          version,
        });
      }
    } finally {
      content.dispose?.();
    }
    if (hits.length >= 80) break;
  }
  signal?.throwIfAborted();
  return hits;
}
export async function materializeReaderContent(book: ReaderBook): Promise<ReaderBook> {
  if (!hasDeferredContent(book)) return book;
  const sections: ReaderSection[] = [];
  for (const section of book.sections) {
    const { textRange: _range, contentInfo: _info, ...metadata } = section;
    const content = await readSectionContent(section);
    try {
      sections.push({ ...metadata, text: content.text, html: content.html });
    } finally {
      content.dispose?.();
    }
  }
  return { ...book, sections };
}

export function releaseBookResources(book: ReaderBook): void {
  releaseReaderContent(book);
  const embedded = new Set(
    book.sections.flatMap((section) => section.html?.match(/blob:[^\s"'<>]+/gu) ?? []),
  );
  for (const url of embedded) URL.revokeObjectURL(url);
  if (book.source.objectUrl !== undefined) URL.revokeObjectURL(book.source.objectUrl);
  if (book.coverUrl !== undefined) URL.revokeObjectURL(book.coverUrl);
  for (const section of book.sections) {
    if (section.imageUrl !== undefined && section.imageUrl !== book.coverUrl) {
      URL.revokeObjectURL(section.imageUrl);
    }
  }
}

/** Bind cold snapshots without opening every source during library startup. */
export function attachDeferredSource(
  sections: readonly ReaderSection[],
  open: (signal: AbortSignal) => Promise<ReaderBook>,
): readonly ReaderSection[] {
  const controller = new AbortController();
  let opening: Promise<ReaderBook> | undefined;
  let opened: ReaderBook | undefined;
  const source = () =>
    (opening ??= open(controller.signal)
      .then((book) => {
        if (controller.signal.aborted) {
          releaseBookResources(book);
          controller.signal.throwIfAborted();
        }
        if (
          book.sections.length !== sections.length ||
          book.sections.some((section, i) => section.id !== sections[i]?.id)
        ) {
          releaseBookResources(book);
          throw new Error("源文件章节索引不一致");
        }
        opened = book;
        return book;
      })
      .catch((error) => {
        opening = undefined;
        throw error;
      }));
  return attachReaderContent(sections, {
    async read(index, signal, purpose) {
      signal.throwIfAborted();
      controller.signal.throwIfAborted();
      const book = await source();
      signal.throwIfAborted();
      return readSectionContent(book.sections[index]!, signal, purpose);
    },
    dispose() {
      controller.abort();
      if (opened) releaseBookResources(opened);
    },
  });
}
