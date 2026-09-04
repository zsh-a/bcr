import type { ReaderBook, ReaderSection } from "@bcr/reader-core";

export interface ReaderInternalLinkTarget {
  readonly sectionId: string;
  readonly fragment?: string | undefined;
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
