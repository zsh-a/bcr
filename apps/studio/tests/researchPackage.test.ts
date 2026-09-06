import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BlobWriter,
  BlobReader,
  TextReader,
  TextWriter,
  ZipReader,
  ZipWriter,
} from "@zip.js/zip.js";
import { createTextCitation, hashReadableStream, textVersion } from "@bcr/core";
import { DEFAULT_READER_SETTINGS } from "@bcr/reader-studio/model";
import {
  inspectResearchPackage,
  researchVolumeStatus,
  previewResearchPackageImport,
  bindResearchPackage,
  restoreResearchPackage,
  planResearchPackage,
  createResearchPackage,
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
  it("cancels package inspection during nested Reader validation", async () => {
    const file = await fixture();
    const controller = new AbortController();
    const before = getReaderState().library;
    await expect(
      inspectResearchPackage(
        file,
        (message) => {
          if (message.startsWith("正在校验 · Title")) controller.abort();
        },
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(getReaderState().library).toBe(before);
    await expect(inspectResearchPackage(file)).resolves.toBeDefined();
  });
  it("distinguishes cancellation from a missing source and stops archive assembly", async () => {
    await createReaderRuntime();
    reader.hydrate([], {}, DEFAULT_READER_SETTINGS);
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
    const prepared = await inspectResearchPackage(await fixture());
    const bindings = await restoreReaderTransfer(prepared.reader, () => {});
    const bound = bindResearchPackage(prepared.backup, bindings).library;
    const checking = new AbortController();
    await expect(
      planResearchPackage(
        bound,
        false,
        (message) => {
          if (message.startsWith("正在检查")) checking.abort();
        },
        checking.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    const plan = await planResearchPackage(bound, false);
    expect(plan.references[0]!.state).toBe("ready");
    const exporting = new AbortController();
    await expect(
      createResearchPackage(
        plan,
        (message) => {
          if (message.startsWith("正在组装")) exporting.abort();
        },
        exporting.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    const completed = await createResearchPackage(plan, () => {});
    expect((await inspectResearchPackage(completed)).reader.manifest.books).toHaveLength(1);
  });
  it("restores independent volumes out of order and repeats without copying collections", async () => {
    await createReaderRuntime();
    reader.hydrate([], {}, DEFAULT_READER_SETTINGS);
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
    const prepared = await inspectResearchPackage(await fixture());
    const source = new Blob(["第二份独立证据"]);
    const hash = await hashReadableStream(source.stream());
    const first = prepared.reader.manifest.books[0]!;
    const second = {
      book: {
        ...first.book,
        id: "other",
        title: "Other",
        source: { ...first.book.source, size: source.size },
      },
      source: { path: `sources/${hash}`, hash, size: source.size },
    };
    const expanded = {
      manifest: { ...prepared.reader.manifest, books: [first, second] },
      sources: new Map([...prepared.reader.sources, [`sources/${hash}`, source]]),
    };
    const bindings = await restoreReaderTransfer(expanded, () => {});
    const item = library.collections[0]!.excerpts[0]!;
    const history = {
      documentId: item.documentId,
      title: item.title,
      source: item.source,
      owner: "reader",
      text: item.text,
      route: "/reader?book=other&section=section",
      linkedAt: 2,
      citation: {
        ...citation,
        source: {
          ...citation.source,
          scope: JSON.stringify(["reader", "other", "section"]),
          unit: JSON.stringify(["reader", "other", "section"]),
        },
      },
    };
    const backup = {
      ...prepared.backup,
      library: {
        ...library,
        collections: [
          {
            ...library.collections[0]!,
            excerpts: [
              { ...item, links: [history] },
              { ...item, id: "other-excerpt", route: "/reader?book=other&section=section" },
            ],
          },
        ],
      },
    };
    const bound = bindResearchPackage(backup, bindings).library;
    const limit = Math.max(first.source!.size, source.size);
    await expect(planResearchPackage(bound, false, () => {}, undefined, limit - 1)).rejects.toThrow(
      "超过单卷",
    );
    const plan = await planResearchPackage(bound, false, () => {}, undefined, limit);
    expect(plan.volumes).toHaveLength(2);
    expect(plan.sourceBytes).toBe(first.source!.size + source.size);
    const files = [];
    for (let i = 0; i < plan.volumes.length; i++)
      files.push(await createResearchPackage(plan, () => {}, undefined, i));
    // A valid ZIP with a false volume number must fail before restoring anything.
    const input = new ZipReader(new BlobReader(files[0]!));
    const output = new ZipWriter(new BlobWriter());
    for (const entry of await input.getEntries()) {
      if (entry.filename === "manifest.json") {
        const manifest = JSON.parse(await entry.getData!(new TextWriter()));
        manifest.volume.index = 2;
        await output.add(entry.filename, new TextReader(JSON.stringify(manifest)));
      } else
        await output.add(entry.filename, new BlobReader(await entry.getData!(new BlobWriter())));
    }
    await input.close();
    await expect(inspectResearchPackage(await output.close())).rejects.toThrow("分卷目录不匹配");
    const volumes = [];
    for (const file of files) volumes.push(await inspectResearchPackage(file));
    await createReaderRuntime();
    reader.hydrate([], {}, DEFAULT_READER_SETTINGS);
    let current: ResearchLibrary = { version: 1, collections: [] };
    const write = async (change: (value: ResearchLibrary) => ResearchLibrary) => {
      current = change(current);
    };
    await restoreResearchPackage(volumes[1]!, write, () => {});
    expect(current.collections).toHaveLength(1);
    expect((await researchVolumeStatus(volumes[1]!)).map((book) => book.restored)).toEqual([
      false,
      true,
    ]);
    const firstImport = current;
    for (const index of [1, 0, 1, 0]) {
      expect(
        (await previewResearchPackageImport(volumes[index]!, current)).collections.skipped,
      ).toBe(1);
      await restoreResearchPackage(volumes[index]!, write, () => {});
      expect(current).toEqual(firstImport);
    }
    expect(getReaderState().library.filter((book) => book.id.startsWith("research-"))).toHaveLength(
      2,
    );
    expect((await researchVolumeStatus(volumes[0]!)).every((book) => book.restored)).toBe(true);
    expect(current.collections[0]!.excerpts[0]!.text).toBe(item.text);
    expect(current.collections[0]!.excerpts[0]!.citation).toEqual(item.citation);
    expect(current.collections[0]!.excerpts[0]!.links).toEqual([history]);
    expect(current.collections[0]!.excerpts[0]!.readerBindings).toHaveLength(2);
    expect(current.collections[0]!.excerpts[0]!.readerBindings![0]!.volume).toEqual({
      set: plan.set,
      index: 1,
      total: 2,
    });
    expect(decodeResearch(JSON.stringify(current))).toEqual(current);
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
