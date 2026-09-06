import { describe, expect, it, vi } from "vitest";
import type { ReaderSection } from "@bcr/reader-core";
import { createDemoBook } from "../src/model";
import { persistBook, restoreSectionSnapshots } from "../src/readerPersistence";
import {
  attachReaderContent,
  attachDeferredSource,
  readSectionContent,
  loadSectionContent,
  subscribeSectionContent,
  releaseReaderContent,
  searchReaderContent,
  sectionContentReady,
  type SectionContent,
} from "../src/readerContent";

const metadata = (count = 3): ReaderSection[] =>
  Array.from({ length: count }, (_, order) => ({
    id: `chapter-${order}`,
    order,
    kind: "text",
    label: `Chapter ${order}`,
    text: "",
    contentInfo: { textLength: 20, readingWeight: 20 },
  }));

describe("publication content sessions", () => {
  it("opens a cold source once for concurrent reads and releases it when replaced", async () => {
    const close = vi.fn();
    const open = vi.fn(async () => ({
      ...createDemoBook(),
      sections: attachReaderContent(metadata(), {
        async read(index) {
          return { text: `source ${index}` };
        },
        dispose: close,
      }),
    }));
    const sections = attachDeferredSource(metadata(), open);
    const book = { ...createDemoBook(), sections };
    expect(open).not.toHaveBeenCalled();
    const values = await Promise.all([
      readSectionContent(sections[0]!),
      readSectionContent(sections[2]!),
    ]);
    expect(values.map((value) => value.text)).toEqual(["source 0", "source 2"]);
    expect(open).toHaveBeenCalledTimes(1);
    expect(sections.every((section) => !sectionContentReady(section))).toBe(true);
    releaseReaderContent(book);
    expect(close).toHaveBeenCalledTimes(1);
    await expect(readSectionContent(sections[0]!)).rejects.toThrow("已关闭");
  });

  it("deduplicates reads, pins visible resources and releases each resource once", async () => {
    const dispose = Array.from({ length: 3 }, () => vi.fn());
    const read = vi.fn(async (index: number) => ({
      text: `body ${index}`,
      dispose: dispose[index]!,
    }));
    const close = vi.fn();
    const sections = attachReaderContent(metadata(), {
      read,
      dispose: close,
      budget: { entries: 1, bytes: 100 },
    });
    const book = { ...createDemoBook(), sections };
    const snapshot = persistBook(book);
    const listener = vi.fn();
    const unpin = subscribeSectionContent(sections[0], listener);
    const secondUnpin = subscribeSectionContent(sections[0], listener);
    await Promise.all([loadSectionContent(sections[0]!), loadSectionContent(sections[0]!)]);
    expect(read).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(2);
    await loadSectionContent(sections[1]!);
    expect(sectionContentReady(sections[0])).toBe(true);
    expect(dispose[1]).toHaveBeenCalledTimes(1);
    unpin();
    expect(dispose[0]).not.toHaveBeenCalled();
    expect(persistBook(book)).toEqual(snapshot);
    secondUnpin();
    expect(dispose[0]).toHaveBeenCalledTimes(1);
    releaseReaderContent(book);
    releaseReaderContent(book);
    expect(close).toHaveBeenCalledTimes(1);
    await expect(loadSectionContent(sections[0]!)).rejects.toThrow("已关闭");
  });

  it("aborts abandoned work without letting its late completion replace a retry", async () => {
    const requests: { signal: AbortSignal; resolve: (value: SectionContent) => void }[] = [];
    const sections = attachReaderContent(metadata(), {
      read: (_index, signal) => new Promise((resolve) => requests.push({ signal, resolve })),
    });
    const keepOther = subscribeSectionContent(sections[1], () => {});
    const unpin = subscribeSectionContent(sections[0], () => {});
    const oldRead = loadSectionContent(sections[0]!);
    const rejected = expect(oldRead).rejects.toMatchObject({ name: "AbortError" });
    unpin();
    expect(requests[0]!.signal.aborted).toBe(true);
    const repin = subscribeSectionContent(sections[0], () => {});
    const newRead = loadSectionContent(sections[0]!);
    const dispose = vi.fn();
    requests[0]!.resolve({ text: "old", dispose });
    await rejected;
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(loadSectionContent(sections[0]!)).toBe(newRead);
    requests[1]!.resolve({ text: "new" });
    await newRead;
    expect(sections[0]!.text).toBe("new");
    repin();
    keepOther();
  });

  it("searches the source without warming display resources or changing persisted metadata", async () => {
    const dispose = vi.fn();
    const read = vi.fn(async (index: number) => ({ text: `${index} 😀苹果`, dispose }));
    const sections = attachReaderContent(metadata(), { read });
    const book = { ...createDemoBook(), sections };
    const hits = await searchReaderContent(book, "苹果");
    expect(hits.map((hit) => [hit.sectionId, hit.matchStart])).toEqual([
      ["chapter-0", 4],
      ["chapter-1", 4],
      ["chapter-2", 4],
    ]);
    expect(read.mock.calls).toHaveLength(3);
    expect(dispose).toHaveBeenCalledTimes(3);
    expect(sections.every((section) => !sectionContentReady(section))).toBe(true);
    expect(restoreSectionSnapshots(book, persistBook(book))).toBe(sections);
    const invalid = persistBook({ ...book, sections: sections.slice(1) });
    expect(() => restoreSectionSnapshots(book, invalid)).toThrow("结构");
    const controller = new AbortController();
    controller.abort();
    await expect(searchReaderContent(book, "苹果", controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    releaseReaderContent(book);
  });
});
