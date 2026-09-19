import {
  createDocumentContentPackage,
  type DocumentContentPackage,
  type DocumentFormat,
} from "@bcr/document-core";
import type { ArtifactRef } from "@bcr/core";
import type { ReaderBook, ReaderSection } from "@bcr/reader-core";

/**
 * Reader keeps a few publication formats that Document does not parse itself
 * (CBR/MOBI/AZW3). They still have a stable canonical representation; the
 * format is deliberately marked unknown so Document never routes them through
 * its text extractor by accident.
 */
export function documentFormatForReader(format: ReaderBook["source"]["format"]): DocumentFormat {
  switch (format) {
    case "txt":
    case "markdown":
    case "html":
    case "docx":
    case "fb2":
    case "epub":
    case "pdf":
    case "cbz":
      return format;
    default:
      return "unknown";
  }
}

function blockKind(section: ReaderSection): "paragraph" | "image" | "page" {
  if (section.kind === "image") return "image";
  if (section.kind === "pdf-page") return "page";
  return "paragraph";
}

/**
 * Project the Reader's already parsed publication into the shared Document
 * content contract. The projection intentionally keeps section IDs and
 * source navigation fields so search, translation and future round-trips can
 * preserve semantic identity.
 */
export function readerBookToDocumentContent(
  book: ReaderBook,
  sourceRef?: ArtifactRef,
  createdAt = book.updatedAt,
): DocumentContentPackage {
  return createDocumentContentPackage({
    id: `reader/${book.id}`,
    format: documentFormatForReader(book.source.format),
    sourceName: book.source.name,
    ...(sourceRef === undefined ? {} : { sourceRef }),
    metadata: {
      title: book.title,
      ...(book.author === undefined ? {} : { author: book.author }),
      ...(book.language === undefined ? {} : { language: book.language }),
    },
    blocks: book.sections.map((section) => ({
      id: section.id,
      order: section.order,
      kind: blockKind(section),
      label: section.label,
      text: section.text,
      ...(section.html === undefined ? {} : { html: section.html }),
      ...(section.pageNumber === undefined ? {} : { pageNumber: section.pageNumber }),
      ...(section.href === undefined ? {} : { href: section.href }),
    })),
    adapter: "reader.projection",
    ...(book.source.ref?.hash === undefined ? {} : { sourceHash: book.source.ref.hash }),
    createdAt,
  });
}
