import type { ReaderBook, ReaderSection, ReaderTocItem } from "@bcr/reader-core";
import { reader } from "../state/store";

export interface ReaderInternalLinkTarget {
  readonly sectionId: string;
  readonly fragment?: string | undefined;
}

// Publications are immutable snapshots; reuse indexes while scrolling large TOCs.
const publicationIndexes = new WeakMap<
  ReaderBook,
  {
    byId: Map<string, ReaderSection>;
    byHref: Map<string, ReaderSection>;
    position: Map<string, number>;
  }
>();
function indexPublication(book: ReaderBook) {
  const existing = publicationIndexes.get(book);
  if (existing) return existing;
  const byId = new Map<string, ReaderSection>();
  const byHref = new Map<string, ReaderSection>();
  const position = new Map<string, number>();
  book.sections.forEach((section, index) => {
    byId.set(section.id, section);
    position.set(section.id, index);
    if (section.href !== undefined) {
      const path = normalizePublicationPath(section.href);
      if (!byHref.has(path)) byHref.set(path, section);
    }
  });
  const result = { byId, byHref, position };
  publicationIndexes.set(book, result);
  return result;
}

export function resolveReaderTocTarget(
  book: ReaderBook,
  item: ReaderTocItem,
): ReaderInternalLinkTarget | undefined {
  const [path, fragment] = (item.href ?? "").split("#");
  const index = indexPublication(book);
  const section =
    index.byId.get(item.sectionId ?? "") ??
    index.byHref.get(normalizePublicationPath(decodeLinkPart(path ?? "")));
  return section
    ? { sectionId: section.id, ...(fragment ? { fragment: decodeLinkPart(fragment) } : {}) }
    : undefined;
}

/** A chapter remains current until the next TOC boundary, including later spine sections. */
export function currentReaderTocItem(
  book: ReaderBook,
  items: ReadonlyArray<ReaderTocItem>,
  sectionId: string | null,
): ReaderTocItem | undefined {
  const positions = indexPublication(book).position;
  const active = positions.get(sectionId ?? "") ?? -1;
  let current: ReaderTocItem | undefined;
  let currentIndex = -1;
  for (const item of items) {
    const target = resolveReaderTocTarget(book, item);
    const index = positions.get(target?.sectionId ?? "") ?? -1;
    if (index >= 0 && index <= active && index > currentIndex) {
      current = item;
      currentIndex = index;
    }
  }
  return current;
}

export function openReaderTocItem(book: ReaderBook, item: ReaderTocItem): void {
  const target = resolveReaderTocTarget(book, item);
  if (!target) return;
  window.dispatchEvent(
    new CustomEvent("bcr-reader-internal-link", { detail: { bookId: book.id, target } }),
  );
  // The store is loaded by the UI before this action is used.
  reader.openBook(book.id, target.sectionId);
}

function decodeLinkPart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizePublicationPath(value: string): string {
  const parts: string[] = [];
  for (const part of value.replaceAll("\\", "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function publicationDirectory(value: string): string {
  return normalizePublicationPath(value).split("/").slice(0, -1).join("/");
}

/** Resolve a relative publication href without treating it as an application URL. */
export function resolveReaderInternalLink(
  book: ReaderBook,
  sourceSection: ReaderSection,
  rawHref: string,
): ReaderInternalLinkTarget | undefined {
  const href = rawHref.trim();
  if (href === "" || /^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(href)) return undefined;

  const hashIndex = href.indexOf("#");
  const rawFragment = hashIndex < 0 ? undefined : href.slice(hashIndex + 1);
  const resourceWithQuery = hashIndex < 0 ? href : href.slice(0, hashIndex);
  const queryIndex = resourceWithQuery.indexOf("?");
  const rawResource = queryIndex < 0 ? resourceWithQuery : resourceWithQuery.slice(0, queryIndex);
  const fragment =
    rawFragment === undefined || rawFragment === "" ? undefined : decodeLinkPart(rawFragment);

  if (rawResource === "") {
    return {
      sectionId: sourceSection.id,
      ...(fragment === undefined ? {} : { fragment }),
    };
  }
  if (sourceSection.href === undefined) return undefined;

  const resource = decodeLinkPart(rawResource);
  const resolvedPath = resource.startsWith("/")
    ? normalizePublicationPath(resource)
    : normalizePublicationPath(`${publicationDirectory(sourceSection.href)}/${resource}`);
  const targetSection = book.sections.find(
    (section) =>
      section.href !== undefined && normalizePublicationPath(section.href) === resolvedPath,
  );
  if (targetSection === undefined) return undefined;
  return {
    sectionId: targetSection.id,
    ...(fragment === undefined ? {} : { fragment }),
  };
}
