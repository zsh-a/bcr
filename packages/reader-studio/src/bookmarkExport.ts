import type { ReaderBook, ReaderBookmark } from "@bcr/reader-core";

/** A standalone document retains semantic positions, without ephemeral source URLs. */
export function readerBookmarksDocument(
  book: ReaderBook,
  bookmarks: ReadonlyArray<ReaderBookmark>,
  exportedAt = Date.now(),
) {
  return {
    format: "bcr-reader-bookmarks" as const,
    version: 1,
    exportedAt,
    book: {
      id: book.id,
      title: book.title,
      ...(book.author === undefined ? {} : { author: book.author }),
      sourceFormat: book.source.format,
      ...(book.source.ref?.hash === undefined ? {} : { sourceHash: book.source.ref.hash }),
    },
    bookmarks: [...bookmarks].sort((left, right) => right.createdAt - left.createdAt),
  };
}

export function downloadReaderBookmarks(
  book: ReaderBook,
  bookmarks: ReadonlyArray<ReaderBookmark>,
): void {
  const blob = new Blob([JSON.stringify(readerBookmarksDocument(book, bookmarks), null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${book.title.replace(/[<>:"/\\|?*]|\p{Cc}/gu, "_").slice(0, 80) || "reader"}-bookmarks.json`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
