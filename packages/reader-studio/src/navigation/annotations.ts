import {
  firstLocator,
  progressForLocator,
  sameLocator,
  type ReaderAnnotation,
  type ReaderBookmark,
  type ReaderLocator,
} from "@bcr/reader-core";
import { activeBook } from "../state/model";
import type { ReaderStatePort } from "../state/port";

export function createReaderAnnotationsActions(port: ReaderStatePort) {
  const { getSnapshot, update } = port;

  function toggleBookmark(): void {
    const book = activeBook(getSnapshot());
    if (book === undefined) return;
    const progress =
      getSnapshot().progressByBook[book.id] ?? progressForLocator(book, firstLocator(book));
    const current = getSnapshot().bookmarksByBook[book.id] ?? [];
    const existing = current.findIndex((bookmark) =>
      sameLocator(bookmark.locator, progress.locator),
    );
    if (existing >= 0) {
      update({
        bookmarksByBook: {
          ...getSnapshot().bookmarksByBook,
          [book.id]: current.filter((_bookmark, index) => index !== existing),
        },
      });
      return;
    }
    const now = Date.now();
    const section = book.sections.find((candidate) => candidate.id === progress.locator.sectionId);
    const bookmark: ReaderBookmark = {
      id: `bookmark-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      label: section?.label ?? "阅读位置",
      locator: progress.locator,
      createdAt: now,
    };
    update({
      bookmarksByBook: {
        ...getSnapshot().bookmarksByBook,
        [book.id]: [bookmark, ...current],
      },
    });
  }

  function removeBookmark(bookId: string, bookmarkId: string): void {
    const current = getSnapshot().bookmarksByBook[bookId] ?? [];
    const next = current.filter((bookmark) => bookmark.id !== bookmarkId);
    if (next.length === current.length) return;
    update({ bookmarksByBook: { ...getSnapshot().bookmarksByBook, [bookId]: next } });
  }

  function renameBookmark(bookId: string, bookmarkId: string, label: string): void {
    const trimmed = label.trim().slice(0, 160);
    if (!trimmed) return;
    const current = getSnapshot().bookmarksByBook[bookId] ?? [];
    update({
      bookmarksByBook: {
        ...getSnapshot().bookmarksByBook,
        [bookId]: current.map((item) =>
          item.id === bookmarkId ? { ...item, label: trimmed } : item,
        ),
      },
    });
  }

  function addAnnotation(note: string, locator?: ReaderLocator): void {
    const book = activeBook(getSnapshot());
    const trimmed = note.trim();
    if (book === undefined || trimmed.length === 0) return;
    const progress =
      locator === undefined
        ? (getSnapshot().progressByBook[book.id] ?? progressForLocator(book, firstLocator(book)))
        : progressForLocator(book, locator);
    const current = getSnapshot().annotationsByBook[book.id] ?? [];
    const now = Date.now();
    const section = book.sections.find((candidate) => candidate.id === progress.locator.sectionId);
    const annotation: ReaderAnnotation = {
      id: `annotation-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      label: section?.label ?? "阅读位置",
      note: trimmed.slice(0, 2_000),
      locator: progress.locator,
      createdAt: now,
      updatedAt: now,
    };
    update({
      annotationsByBook: {
        ...getSnapshot().annotationsByBook,
        [book.id]: [annotation, ...current],
      },
    });
  }

  function removeAnnotation(bookId: string, annotationId: string): void {
    const current = getSnapshot().annotationsByBook[bookId] ?? [];
    const next = current.filter((annotation) => annotation.id !== annotationId);
    if (next.length === current.length) return;
    update({ annotationsByBook: { ...getSnapshot().annotationsByBook, [bookId]: next } });
  }

  function updateAnnotation(bookId: string, annotationId: string, note: string): void {
    const trimmed = note.trim().slice(0, 2000);
    if (!trimmed) return;
    const current = getSnapshot().annotationsByBook[bookId] ?? [];
    update({
      annotationsByBook: {
        ...getSnapshot().annotationsByBook,
        [bookId]: current.map((item) =>
          item.id === annotationId
            ? { ...item, note: trimmed, updatedAt: Math.max(Date.now(), item.updatedAt + 1) }
            : item,
        ),
      },
    });
  }

  return {
    toggleBookmark,
    removeBookmark,
    renameBookmark,
    addAnnotation,
    removeAnnotation,
    updateAnnotation,
  };
}
