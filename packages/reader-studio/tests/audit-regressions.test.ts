import { beforeEach, describe, expect, it, vi } from "vitest";
import { Context, Effect, Layer } from "effect";
import { artifactStore, ArtifactStoreTag, contentHash } from "@bcr/core";
import { createLocator, makeSearchSnippet } from "@bcr/reader-core";
import { MemoryStore } from "@bcr/storage-opfs";
import { createDemoBook, DEFAULT_READER_SETTINGS, readingStatus } from "../src/model";
import { readerBookmarksDocument } from "../src/bookmarkExport";
import { getReaderState, reader } from "../src/store";
import { attachReaderContent } from "../src/readerContent";
import { importReaderFile } from "../src/readerImports";
import { searchReaderDetailed } from "../src/readerSearch";
import { openSearchHit } from "../src/readerSearchNavigation";
import {
  decodeReaderBackup,
  backupSkippedBooks,
  preflightReaderBackup,
  createReaderBackup,
  inspectReaderBackup,
  prepareReaderRestore,
} from "../src/readerBackup";
import { resolveReaderTocTarget, currentReaderTocItem } from "../src/navigation";
import type { ReaderRuntime } from "../src/runtime";

async function runtime(): Promise<ReaderRuntime> {
  const binary = new MemoryStore();
  const context = await Effect.runPromise(
    Effect.scoped(Layer.build(artifactStore({ opfs: binary, memory: binary }))),
  );
  return {
    binary,
    artifacts: Context.get(context, ArtifactStoreTag),
    ftsReady: false,
    meta: undefined,
    indexSession: undefined,
    parseSession: undefined,
    parserMode: "main",
  };
}
const book = createDemoBook();
beforeEach(() => reader.hydrate([book], {}, DEFAULT_READER_SETTINGS, {}, book.id));

describe("Reader audit regressions", () => {
  it("retains renamed metadata during source restoration and validates favorite preferences", () => {
    reader.renameBook(book.id, "  自定义书名  ");
    reader.toggleFavorite(book.id);
    const renamed = getReaderState().library[0]!;
    reader.replaceBook(book);
    expect(getReaderState().library[0]).toMatchObject({
      title: "自定义书名",
      updatedAt: renamed.updatedAt,
    });
    expect(getReaderState().library[0]?.favorite).toBe(true);
    const manifest = decodeReaderBackup({
      format: "bcr-reader-backup",
      version: 1,
      createdAt: 1,
      books: [
        {
          book: {
            ...renamed,
            sections: renamed.sections.map(({ html: _html, ...section }) => section),
          },
        },
      ],
      settings: getReaderState().settings,
      progressByBook: {},
      bookmarksByBook: {},
      annotationsByBook: {},
    });
    expect(manifest.books[0]?.book.favorite).toBe(true);
    const invalid = decodeReaderBackup({
      ...manifest,
      books: [{ book: { ...manifest.books[0]!.book, favorite: "yes" } }],
    });
    expect(invalid.books[0]?.book.favorite).toBeUndefined();
  });

  it("removes a batch atomically without moving the unselected active reader", () => {
    const other = { ...book, id: "other-book" };
    const third = { ...book, id: "third-book" };
    reader.hydrate([book, other, third], {}, DEFAULT_READER_SETTINGS, {}, book.id);
    reader.openBook(other.id);
    reader.toggleBookmark();
    reader.addAnnotation("将移除的笔记");
    reader.toggleFavorite(other.id);
    reader.setSettings({ books: { [other.id]: { pdfZoom: 1.5 } } });
    reader.openBook(book.id);
    const locator = createLocator(book.sections[1]!, 0.4);
    reader.setLocator(locator);
    const before = getReaderState().navigationSequence;
    reader.removeBooks([other.id, third.id]);
    expect(getReaderState().library.map((item) => item.id)).toEqual([book.id]);
    expect(getReaderState().activeBookId).toBe(book.id);
    expect(getReaderState().progressByBook[book.id]?.locator).toEqual(locator);
    expect(getReaderState().navigationSequence).toBe(before);
    expect(getReaderState().bookmarksByBook[other.id]).toBeUndefined();
    expect(getReaderState().annotationsByBook[other.id]).toBeUndefined();
    expect(getReaderState().settings.books?.[other.id]).toBeUndefined();
    expect(getReaderState().navigationHistory.back.every((entry) => entry.bookId === book.id)).toBe(
      true,
    );
  });

  it("restores favorite metadata from a verified ZIP independently of layout settings", async () => {
    const rt = await runtime();
    const favorite = {
      ...book,
      favorite: true,
      title: "收藏的书",
      sections: book.sections.map(({ html: _html, ...section }) => section),
    };
    const blob = await createReaderBackup(rt, { ...getReaderState(), library: [favorite] });
    const inspected = await inspectReaderBackup(blob);
    const restored = await prepareReaderRestore(rt, inspected, []);
    expect(restored[0]).toMatchObject({ title: favorite.title, favorite: true });
  });

  it("navigates to a retained book when the batch includes the current reader", () => {
    const other = { ...book, id: "retained-book" };
    reader.hydrate([book, other], {}, DEFAULT_READER_SETTINGS, {}, book.id);
    reader.setLocator(createLocator(book.sections[2]!, 0.8));
    const sequence = getReaderState().navigationSequence;
    reader.removeBooks([book.id]);
    expect(getReaderState().activeBookId).toBe(other.id);
    expect(getReaderState().progressByBook[book.id]).toBeUndefined();
    expect(getReaderState().progressByBook[other.id]?.locator).toEqual(
      createLocator(other.sections[0]!),
    );
    expect(getReaderState().navigationSequence).toBe(sequence + 1);
  });

  it("shares search capacity across books while reallocating unused slots", async () => {
    const rt = await runtime();
    const fixtures = [100, 100, 2].map((count, index) => ({
      ...book,
      id: `fair-${index}`,
      sections: [{ ...book.sections[0]!, text: "needle ".repeat(count) }],
    }));
    const result = await searchReaderDetailed(rt, fixtures, "needle");
    expect(
      fixtures.map((item) => result.hits.filter((hit) => hit.bookId === item.id).length),
    ).toEqual([39, 39, 2]);
    expect(result.truncated).toBe(true);
    expect(result.hits[0]?.bookId).toBe(fixtures[0]!.id);
    expect(result.hits.at(-1)?.bookId).toBe(fixtures[2]!.id);
  });

  it("exports standalone bookmark positions and source identity without temporary URLs", () => {
    reader.setLocator(createLocator(book.sections[1]!, 0.4));
    reader.toggleBookmark();
    const bookmarks = getReaderState().bookmarksByBook[book.id]!;
    const exported = JSON.parse(
      JSON.stringify(
        readerBookmarksDocument(
          { ...book, source: { ...book.source, objectUrl: "blob:temporary" } },
          bookmarks,
          123,
        ),
      ),
    );
    expect(exported).toMatchObject({
      format: "bcr-reader-bookmarks",
      version: 1,
      exportedAt: 123,
      bookmarks,
    });
    expect(JSON.stringify(exported)).not.toContain("blob:temporary");
  });
  it("preserves anchor and timestamps when editing a note or renaming a bookmark", () => {
    const locator = createLocator(book.sections[1]!, 0.4);
    reader.addAnnotation("原笔记", locator);
    const note = getReaderState().annotationsByBook[book.id]![0]!;
    reader.updateAnnotation(book.id, note.id, "修改后的笔记");
    expect(getReaderState().annotationsByBook[book.id]![0]).toMatchObject({
      locator,
      note: "修改后的笔记",
      createdAt: note.createdAt,
    });
    expect(getReaderState().annotationsByBook[book.id]![0]!.updatedAt).toBeGreaterThan(
      note.updatedAt,
    );
    reader.setLocator(locator);
    reader.toggleBookmark();
    const bookmark = getReaderState().bookmarksByBook[book.id]![0]!;
    reader.renameBookmark(book.id, bookmark.id, "稍后重读");
    expect(getReaderState().bookmarksByBook[book.id]![0]).toEqual({
      ...bookmark,
      label: "稍后重读",
    });
  });

  it("reports a stale search occurrence without opening or replacing its position", async () => {
    const hit = {
      bookId: book.id,
      sectionId: book.sections[1]!.id,
      label: "chapter",
      snippet: "已经变化",
      score: 1,
      matchStart: 0,
      matchLength: 4,
    };
    reader.setSearch("已经变化", [hit], null);
    const sequence = getReaderState().navigationSequence;
    await openSearchHit(hit);
    expect(getReaderState().searchError).toContain("命中位置已变化");
    expect(getReaderState().navigationSequence).toBe(sequence);
    expect(getReaderState().searchHits).toEqual([hit]);
  });

  it("propagates deferred search failures and distinguishes exactly 80 from truncation", async () => {
    const rt = await runtime();
    for (const count of [80, 81]) {
      const fixture = {
        ...book,
        sections: [{ ...book.sections[0]!, text: "needle ".repeat(count) }],
      };
      const result = await searchReaderDetailed(rt, [fixture], "needle");
      expect(result.hits).toHaveLength(80);
      expect(result.truncated).toBe(count === 81);
    }
    const broken = {
      ...book,
      sections: attachReaderContent(
        [{ ...book.sections[0]!, text: "", contentInfo: { textLength: 10 } }],
        {
          async read() {
            throw new Error("正文损坏");
          },
        },
      ),
    };
    await expect(searchReaderDetailed(rt, [broken], "needle")).rejects.toThrow("正文损坏");
  });

  it("maps a specific snippet occurrence through whitespace collapse and escapes no source text", () => {
    const text = "  needle\n\n前文 ＡＢ\tＣ 后文 needle  ";
    const start = text.indexOf("ＡＢ");
    const result = makeSearchSnippet(text, start, 4);
    expect(
      result.snippet.slice(
        result.snippetMatchStart,
        result.snippetMatchStart! + result.snippetMatchLength!,
      ),
    ).toBe("ＡＢ Ｃ");
  });

  it("skips duplicate parsing after hashing and cleans a failed import's new artifact", async () => {
    const rt = await runtime();
    const file = new File(["本地正文"], "book.txt", { type: "text/plain" });
    const first = await importReaderFile(rt, file);
    const open = vi.fn(async () => {
      throw new Error("should not parse duplicate");
    });
    rt.parseSession = { open, close() {} };
    expect(await importReaderFile(rt, file, undefined, [first])).toBe(first);
    expect(open).not.toHaveBeenCalled();
    const invalid = new File(["invalid pdf"], "broken.txt", { type: "text/plain" });
    await expect(importReaderFile(rt, invalid)).rejects.toThrow();
    const hash = contentHash(new TextEncoder().encode("invalid pdf"));
    expect(
      await Effect.runPromise(
        rt.artifacts.has({
          id: `reader/${hash}`,
          hash,
          storage: "memory",
          type: "file/publication",
          format: "text/plain",
        }),
      ),
    ).toBe(false);
  });

  it("preflights missing sources and discloses skipped same-source reading records", async () => {
    const rt = await runtime();
    const imported = await importReaderFile(rt, new File(["原文"], "source.txt"));
    const manifest = decodeReaderBackup({
      format: "bcr-reader-backup",
      version: 1,
      createdAt: 1,
      books: [
        {
          book: {
            ...book,
            id: "backup-copy",
            sections: book.sections.map(({ html: _html, ...section }) => section),
          },
          source: {
            path: `sources/${imported.source.ref!.hash}`,
            hash: imported.source.ref!.hash,
            size: imported.source.size,
          },
        },
      ],
      settings: DEFAULT_READER_SETTINGS,
      progressByBook: { "backup-copy": { locator: createLocator(book.sections[0]!) } },
      bookmarksByBook: {
        "backup-copy": [
          { id: "b", label: "bookmark", locator: createLocator(book.sections[0]!), createdAt: 1 },
        ],
      },
      annotationsByBook: {},
    });
    expect(backupSkippedBooks(manifest, [imported])).toMatchObject([
      { matchedBy: "source", progress: true, bookmarks: 1, annotations: 0 },
    ]);
    const missing = { ...book, source: { ...book.source, format: "pdf" as const } };
    expect(await preflightReaderBackup(rt, [missing])).toEqual([book.title]);
  });

  it("retains TOC fragments and a chapter across later spine sections", () => {
    const fixture = {
      ...book,
      source: { ...book.source, format: "epub" as const },
      sections: book.sections.map((section, index) => ({ ...section, href: `OPS/${index}.xhtml` })),
    };
    const toc = [
      { id: "one", label: "第一章", sectionId: fixture.sections[0]!.id, href: "OPS/0.xhtml#sec-3" },
      { id: "two", label: "第二章", sectionId: fixture.sections[3]!.id },
    ];
    expect(resolveReaderTocTarget(fixture, toc[0]!)).toEqual({
      sectionId: fixture.sections[0]!.id,
      fragment: "sec-3",
    });
    expect(currentReaderTocItem(fixture, toc, fixture.sections[2]!.id)).toBe(toc[0]);
    expect([readingStatus(), readingStatus(0.5), readingStatus(1)]).toEqual([
      "unread",
      "reading",
      "finished",
    ]);
  });
});
