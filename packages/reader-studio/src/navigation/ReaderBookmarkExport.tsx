import { Download } from "lucide-react";
import type { ReaderBook, ReaderBookmark } from "@bcr/reader-core";
import { downloadReaderBookmarks } from "./bookmarkExport";

export function ReaderBookmarkExport(props: {
  book: ReaderBook;
  bookmarks: ReadonlyArray<ReaderBookmark>;
}) {
  return (
    <button
      type="button"
      className="reader-bookmark-export ui-btn ui-btn-default"
      disabled={!props.bookmarks.length}
      onClick={() => downloadReaderBookmarks(props.book, props.bookmarks)}
    >
      <Download className="reader-icon" />
      导出书签（JSON）
    </button>
  );
}
