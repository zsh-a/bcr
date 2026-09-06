import type { readerTransferState } from "@bcr/reader-studio/research-transfer";
import { textVersion } from "@bcr/core";
import {
  boundReaderExcerpt,
  type ResearchLibrary,
  type ResearchExcerpt,
  type ReaderBinding,
} from "./research";
export interface PackageReference {
  readonly label: string;
  readonly book?: string;
  readonly section?: string;
  readonly version?: string;
  readonly state: "ready" | "missing" | "unsupported" | "historical";
}
type ReferenceBook = ReturnType<typeof readerTransferState>["state"]["library"][number];
function classifyReference(
  book: ReferenceBook | undefined,
  sectionId: string,
  version: string | undefined,
): PackageReference["state"] {
  const chapter = book?.sections.find((section) => section.id === sectionId);
  if (!book?.source.ref || !chapter) return "missing";
  if (!version || textVersion(chapter.text) !== version) return "historical";
  return "ready";
}
function describeReference(
  entry: ResearchExcerpt,
  label: string,
  books: ReadonlyMap<string, ReferenceBook>,
): PackageReference {
  const active = boundReaderExcerpt(entry);
  const url = new URL(active.route, "https://bcr.invalid");
  if (url.pathname !== "/reader") return { label, state: "unsupported" };
  const book = url.searchParams.get("book") ?? "";
  const section = url.searchParams.get("section") ?? "";
  const version = active.citation?.source.version;
  return {
    label,
    book,
    section,
    ...(version ? { version } : {}),
    state: classifyReference(books.get(book), section, version),
  };
}
function excerptRevisions(item: ResearchExcerpt): ResearchExcerpt[] {
  return [item, ...(item.links ?? []).map((link) => ({ ...item, ...link }))];
}
export function collectPackageReferences(
  library: ResearchLibrary,
  books: ReadonlyArray<ReferenceBook>,
): PackageReference[] {
  const byId = new Map(books.map((book) => [book.id, book]));
  const references: PackageReference[] = [];
  for (const collection of library.collections) {
    for (const item of collection.excerpts) {
      for (const [index, entry] of excerptRevisions(item).entries()) {
        const revision = index ? `修订 ${index}` : "最初引用";
        references.push(
          describeReference(entry, `${collection.name} · ${item.title} · ${revision}`, byId),
        );
      }
    }
  }
  return references;
}
function readerBookId(route: string): string | null {
  const url = new URL(route, "https://bcr.invalid");
  return url.pathname === "/reader" ? url.searchParams.get("book") : null;
}
function bindExcerpt(
  item: ResearchExcerpt,
  bindings: ReadonlyMap<string, ReaderBinding>,
): ResearchExcerpt {
  const needed = new Set([item, ...(item.links ?? [])].map((entry) => readerBookId(entry.route)));
  const mapped = new Map<string, ReaderBinding>();
  for (const binding of item.readerBindings ?? []) {
    const next = bindings.get(binding.target);
    mapped.set(binding.book, next ? { ...next, book: binding.book } : binding);
  }
  for (const binding of bindings.values()) {
    if (needed.has(binding.book) && !mapped.has(binding.book)) mapped.set(binding.book, binding);
  }
  return { ...item, readerBindings: [...mapped.values()] };
}
export function bindPackageLibrary(
  library: ResearchLibrary,
  bindings: ReadonlyArray<ReaderBinding>,
): ResearchLibrary {
  const byId = new Map<string, ReaderBinding>();
  for (const binding of bindings) if (!byId.has(binding.book)) byId.set(binding.book, binding);
  const collections = library.collections.map((collection) => {
    const excerpts = collection.excerpts.map((item) => bindExcerpt(item, byId));
    return { ...collection, excerpts };
  });
  return { ...library, collections };
}
