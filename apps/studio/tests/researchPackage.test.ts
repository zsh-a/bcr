import { afterEach, describe, expect, it, vi } from "vitest";
import { BlobWriter, BlobReader, TextReader, ZipWriter } from "@zip.js/zip.js";
import { createTextCitation, hashReadableStream, textVersion } from "@bcr/core";
import { DEFAULT_READER_SETTINGS } from "@bcr/reader-studio/model";
import {
  inspectResearchPackage,
  bindResearchPackage,
  restoreResearchPackage,
  planResearchPackage,
} from "../src/researchPackage";
import { boundReaderExcerpt, decodeResearch, type ResearchLibrary } from "../src/research";
import { createResearchBackup, planResearchImport } from "../src/researchBackup";
import { createReaderRuntime } from "@bcr/reader-studio/runtime";
import { reader, getReaderState } from "@bcr/reader-studio/store";
import { readerTransferState, restoreReaderTransfer } from "@bcr/reader-studio/research-transfer";
import { Effect } from "effect";
afterEach(() => vi.unstubAllGlobals());
const text = "跨浏览器引用证据。";
const citation = createTextCitation(
  text,
  {
    scope: JSON.stringify(["reader", "old", "section"]),
    unit: JSON.stringify(["reader", "old", "section"]),
    offset: 0,
    version: textVersion(text),
  },
  { start: 0, end: 5 },
);
const library: ResearchLibrary = {
  version: 1,
  collections: [
    {
      id: "collection",
      name: "资料",
      excerpts: [
        {
          id: "excerpt",
          documentId: "doc",
          title: "Title",
          source: "Reader",
          owner: "reader",
          route: "/reader?book=old&section=section",
          text,
          note: "笔记",
          savedAt: 1,
          citation,
        },
      ],
    },
  ],
};
async function fixture(corrupt = false) {
  const source = new Blob([text]),
    hash = await hashReadableStream(source.stream());
  const inner = new ZipWriter(new BlobWriter());
  await inner.add(`sources/${hash}`, new BlobReader(source));
  await inner.add(
    "reader.json",
    new TextReader(
      JSON.stringify({
        format: "bcr-reader-backup",
        version: 1,
        createdAt: 1,
        settings: DEFAULT_READER_SETTINGS,
        progressByBook: {},
        bookmarksByBook: {},
        annotationsByBook: {},
        books: [
          {
            book: {
              id: "old",
              title: "Title",
              source: { name: "book.txt", format: "txt", mime: "text/plain", size: source.size },
              sections: [{ id: "section", kind: "text", order: 0, label: "第一节", text }],
              importedAt: 1,
              updatedAt: 1,
              tags: [],
            },
            source: { path: `sources/${hash}`, hash, size: source.size },
          },
        ],
      }),
    ),
  );
  const reader = await inner.close(),
    research = new Blob([
      JSON.stringify(createResearchBackup(library, false, { getItem: () => null })),
    ]);
  const entries = [
    { path: "reader.zip", size: reader.size, hash: await hashReadableStream(reader.stream()) },
    {
      path: "research.json",
      size: research.size,
      hash: corrupt ? "0".repeat(64) : await hashReadableStream(research.stream()),
    },
  ];
  const zip = new ZipWriter(new BlobWriter());
  await zip.add(
    "manifest.json",
    new TextReader(JSON.stringify({ format: "bcr-research-package", version: 1, entries })),
  );
  await zip.add("reader.zip", new BlobReader(reader));
  await zip.add("research.json", new BlobReader(research));
  return zip.close();
}
describe("Reader research packages", () => {
  it("validates nested source hashes before offering any restore", async () => {
    const prepared = await inspectResearchPackage(await fixture());
    expect(prepared.backup.library).toEqual(library);
    expect(prepared.reader.sources.size).toBe(1);
    await expect(inspectResearchPackage(await fixture(true))).rejects.toThrow("哈希");
    await expect(inspectResearchPackage(new Blob(["broken ZIP"]))).rejects.toThrow();
  });
  it("retries a collection write failure without duplicating restored sources", async () => {
    await createReaderRuntime();
    reader.hydrate([], {}, DEFAULT_READER_SETTINGS);
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
    const prepared = await inspectResearchPackage(await fixture());
    let current: ResearchLibrary = { version: 1, collections: [] };
    await expect(
      restoreResearchPackage(
        prepared,
        async () => {
          throw new Error("quota");
        },
        () => {},
      ),
    ).rejects.toThrow("集合尚未保存");
    expect(current.collections).toEqual([]);
    const books = getReaderState().library;
    await restoreResearchPackage(
      prepared,
      async (change) => {
        current = change(current);
      },
      () => {},
    );
    expect(getReaderState().library).toBe(books);
    expect(current.collections).toHaveLength(1);
    expect(boundReaderExcerpt(current.collections[0]!.excerpts[0]!).route).toContain(
      "book=research-",
    );
  });
  it("previews original and historical references, retaining readable sources with missing chapters", async () => {
    await createReaderRuntime();
    reader.hydrate([], {}, DEFAULT_READER_SETTINGS);
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
    const prepared = await inspectResearchPackage(await fixture());
    const bindings = await restoreReaderTransfer(prepared.reader, () => {});
    const bound = bindResearchPackage(prepared.backup, bindings).library;
    const collection = bound.collections[0]!,
      item = collection.excerpts[0]!;
    const variants = [
      item,
      {
        ...item,
        id: "historic",
        citation: { ...citation, source: { ...citation.source, version: textVersion("old") } },
      },
      { ...item, id: "missing", route: "/reader?book=old&section=gone" },
      { ...item, id: "other", route: "/documents" },
    ];
    const plan = await planResearchPackage(
      { ...bound, collections: [{ ...collection, excerpts: variants }] },
      false,
    );
    expect(plan.references.map((ref) => ref.state)).toEqual([
      "ready",
      "historical",
      "missing",
      "unsupported",
    ]);
    expect(plan.books).toEqual([bindings[0]!.target]);
    const missingOnly = await planResearchPackage(
      { ...bound, collections: [{ ...collection, excerpts: [variants[2]!] }] },
      false,
    );
    expect(missingOnly.books).toEqual(plan.books);
    const ref = getReaderState().library.find((book) => book.id === bindings[0]!.target)!.source
      .ref!;
    await Effect.runPromise(
      readerTransferState().runtime.artifacts.putStream(
        { ...ref, type: "file/publication", format: ref.mime },
        new Blob(["broken"]).stream(),
      ),
    );
    const corrupt = await planResearchPackage(bound, false);
    expect(corrupt.references[0]!.state).toBe("missing");
    expect(corrupt.books).toEqual([]);
  });
  it("maps routes and citation identities without rewriting the original evidence", () => {
    const backup = createResearchBackup(library, false, { getItem: () => null });
    const imported = bindResearchPackage(backup, [{ book: "old", target: "new" }]);
    const original = library.collections[0]!.excerpts[0]!,
      item = imported.library.collections[0]!.excerpts[0]!;
    expect(item.route).toBe(original.route);
    expect(item.citation).toEqual(original.citation);
    const bound = boundReaderExcerpt(item);
    expect(bound.route).toContain("book=new");
    expect(JSON.parse(bound.citation!.source.scope)).toEqual(["reader", "new", "section"]);
    expect(bound.text).toBe(text);
    expect(decodeResearch(JSON.stringify(imported.library))).toEqual(imported.library);
    expect(planResearchImport(imported.library, imported).skipped).toBe(1);
    const next = bindResearchPackage(imported, [{ book: "new", target: "third" }]);
    expect(boundReaderExcerpt(next.library.collections[0]!.excerpts[0]!).route).toContain(
      "book=third",
    );
  });
});
