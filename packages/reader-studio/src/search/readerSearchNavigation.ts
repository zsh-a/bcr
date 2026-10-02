import { loadSectionContent, subscribeSectionContent } from "../content/readerContent";
import { createTextLocator, normalizeSearchQuery, type SearchHit } from "@bcr/reader-core";
import { getReaderState, reader } from "../state/store";

let searchNavigation = 0;
export async function openSearchHit(hit: SearchHit, index?: number): Promise<void> {
  const state = getReaderState();
  const sequence = ++searchNavigation;
  const target = state.library
    .find((book) => book.id === hit.bookId)
    ?.sections.find((section) => section.id === hit.sectionId);
  const release = subscribeSectionContent(target, () => {});
  try {
    reader.setSearchError(null);
    if (!target) throw new Error("命中所属读物或正文已移除，请重新搜索。");
    if (target) await loadSectionContent(target);
    if (
      sequence !== searchNavigation ||
      getReaderState().navigationSequence !== state.navigationSequence ||
      getReaderState().query !== state.query
    )
      return;
    if (
      normalizeSearchQuery(target.text.slice(hit.matchStart, hit.matchStart + hit.matchLength)) !==
      normalizeSearchQuery(state.query)
    )
      throw new Error("命中位置已变化，请重新搜索后打开。");
    reader.openBook(hit.bookId, hit.sectionId);
    const openedBook = getReaderState().library.find((book) => book.id === hit.bookId);
    const openedSection = openedBook?.sections.find((section) => section.id === hit.sectionId);
    if (openedSection !== undefined) {
      reader.setLocator(
        createTextLocator(
          openedSection,
          hit.matchStart,
          hit.matchStart + Math.max(1, hit.matchLength),
        ),
      );
    }
    // Keep the query as a lightweight reading context so the destination can
    // show the exact hit in the body. Opening a chapter normally still clears
    // search state through ReaderStore.openBook.
    if (state.query.trim() !== "") reader.setSearch(state.query, state.searchHits, hit.bookId);
    if (index !== undefined) reader.setSearchActiveIndex(index);
    reader.revealSearchHit(hit);
    reader.setSearchOpen(false);
  } catch (reason) {
    if (sequence === searchNavigation && getReaderState().query === state.query)
      reader.setSearchError(
        reason instanceof Error ? reason.message : "命中正文加载失败，请重试。",
      );
  } finally {
    release();
  }
}
