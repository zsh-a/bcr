import { describe, expect, it, vi } from "vitest";
import { MemoryStore } from "@bcr/storage-opfs";
import { artifactStore, ArtifactStoreTag } from "@bcr/core";
import { Context, Effect, Layer } from "effect";
import { createLocator, percentageForLocator } from "@bcr/reader-core";
import { createDemoBook } from "../src/model";
import { storeStructuredContent, restoreStructuredContent } from "../src/structuredContent";
import { loadSectionContent, releaseReaderContent } from "../src/readerContent";
import { persistBook } from "../src/readerPersistence";
import type { ReaderRuntime } from "../src/readerRuntimeCore";

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

describe("structured publication blocks", () => {
  it("reads only the requested logical section and restores descriptors without reading bodies", async () => {
    const app = await runtime();
    const demo = createDemoBook();
    const sections = Array.from({ length: 30 }, (_, order) => ({
      id: `original-${order}`,
      order,
      kind: "text" as const,
      label: `Chapter ${order}`,
      text: `${order} ${"正文😀".repeat(3000)}`,
      html: `<p>${order} ${"正文😀".repeat(3000)}</p>`,
    }));
    const original = { ...demo, source: { ...demo.source, format: "docx" as const }, sections };
    const book = await storeStructuredContent(app, original);
    expect(
      book.sections.every((section) => !section.text && section.contentInfo?.storageRange),
    ).toBe(true);
    const snapshot = persistBook(book);
    const locator = createLocator(sections[15]!, 0.3);
    expect(percentageForLocator(book, locator)).toBe(percentageForLocator(original, locator));
    const read = vi.spyOn(app.binary, "readRange");
    await loadSectionContent(book.sections[15]!);
    expect(book.sections[15]!.text).toBe(sections[15]!.text);
    expect(read).toHaveBeenCalledTimes(1);
    const range = book.sections[15]!.contentInfo!.storageRange!;
    expect(read.mock.calls[0]!.slice(1)).toEqual([range.start, range.end - range.start]);
    expect(persistBook(book)).toEqual(snapshot);
    releaseReaderContent(book);
    const restored = await restoreStructuredContent(app, { ...book, sections: snapshot.sections });
    expect(restored).toBeDefined();
    expect(read).toHaveBeenCalledTimes(1);
    await loadSectionContent(restored!.sections[29]!);
    expect(restored!.sections[29]!.html).toBe(sections[29]!.html);
    releaseReaderContent(restored!);
    for (const path of await app.binary.list("reader/content-v1/")) await app.binary.delete(path);
    expect(
      await restoreStructuredContent(app, { ...book, sections: snapshot.sections }),
    ).toBeUndefined();
  });
});
