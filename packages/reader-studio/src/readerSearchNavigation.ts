import { loadSectionContent, subscribeSectionContent } from "./readerContent";
import { createTextLocator, type SearchHit } from "@bcr/reader-core";
import { getReaderState, reader } from "./store";

let searchNavigation = 0;
export async function openSearchHit(hit: SearchHit, index?: number): Promise<void> {
  const state = getReaderState();
  const sequence = ++searchNavigation;
  const target = state.library
    .find((book) => book.id === hit.bookId)
    ?.sections.find((section) => section.id === hit.sectionId);
  const release = subscribeSectionContent(target, () => {});
  try {
    if (target) await loadSectionContent(target);
    if (
      sequence !== searchNavigation ||
      getReaderState().navigationSequence !== state.navigationSequence ||
      getReaderState().query !== state.query
    )
      return;
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
  } catch {
    reader.setSearchBusy(false);
  } finally {
    release();
  }
}
