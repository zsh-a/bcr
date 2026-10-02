import { createTextCitation } from "@bcr/core";
import type { ReaderBook, ReaderLocator } from "@bcr/reader-core";
import type { ResearchCapture } from "@bcr/react";
import { readerCitationSource } from "../researchDocuments";
import { sectionContentReady } from "../content/readerContent";

/** Snapshot only a verified original-text range, preserving the citation contract. */
export function captureReaderSelection(book: ReaderBook, locator: ReaderLocator): ResearchCapture {
  const section = book.sections.find((item) => item.id === locator.sectionId);
  if (section && !sectionContentReady(section))
    throw new Error("选段正文尚未加载成功，请重试加载正文后重新选择。");
  const anchor = locator.textAnchor;
  const start = anchor?.start;
  const end = anchor?.end;
  if (
    !section ||
    !anchor ||
    start === undefined ||
    end === undefined ||
    section.text.slice(start, end) !== anchor.exact
  )
    throw new Error("选段已变化，与原文无法对齐，请重新选择正文。");
  const citation = createTextCitation(section.text, readerCitationSource(book.id, section), {
    start,
    end,
  });
  const params = new URLSearchParams({ book: book.id, section: section.id });
  return {
    document: {
      id: `reader:section:${book.id}:${section.id}:${start}`,
      source: "reader",
      kind: "reader-section",
      title: section.label,
      subtitle: book.title,
      body: citation.exact,
      route: `/reader?${params}`,
      updatedAt: book.updatedAt,
    },
    citation,
    note: "",
  };
}
