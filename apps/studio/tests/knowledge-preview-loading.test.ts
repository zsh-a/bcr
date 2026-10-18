import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { contentHash } from "@bcr/core";
import { MemoryStore } from "@bcr/storage-opfs";
import { KnowledgeAttachments } from "../src/knowledge/attachments/attachments";
import { observePreviewVisibility } from "../src/knowledge/attachments/previewVisibility";
import {
  attachmentPath,
  type KnowledgeAttachment,
} from "../src/knowledge/attachments/attachmentModel";
import { createPreviewQueue } from "../src/knowledge/attachments/previewWork";

const processImage = vi.hoisted(() => vi.fn());
vi.mock("../src/knowledge/attachments/attachmentImport", () => ({
  processAttachment: processImage,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => (resolve = complete));
  return { promise, resolve };
}

async function original(binary: MemoryStore, id: number) {
  const bytes = new Uint8Array([id]);
  const record: KnowledgeAttachment = {
    id: `image-${id}`,
    hash: contentHash(bytes),
    name: `${id}.png`,
    mime: "image/png",
    size: bytes.length,
    width: 2000,
    height: 2000,
    createdAt: 1,
  };
  const storage = new KnowledgeAttachments(binary);
  await storage.put(record, new Blob([bytes]));
  return { record, storage, binary };
}

beforeEach(() => {
  processImage.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("bounded preview generation", () => {
  it("caps work globally across attachment stores and reuses one pending preview per hash", async () => {
    const gates = Array.from({ length: 5 }, () => deferred<{ thumbnail: Blob }>());
    let active = 0,
      maximum = 0;
    processImage.mockImplementation(() => {
      const gate = gates[processImage.mock.calls.length - 1]!;
      maximum = Math.max(maximum, ++active);
      return gate.promise.finally(() => active--);
    });
    const items = await Promise.all(gates.map((_, id) => original(new MemoryStore(), id + 1)));
    const tasks = items.map(({ storage, record }) => storage.preview(record));
    expect(items[0]!.storage.preview(items[0]!.record)).toBe(tasks[0]);
    await vi.waitFor(() => expect(processImage).toHaveBeenCalledTimes(2));
    const thumbnail = new Blob(["thumbnail"], { type: "image/webp" });
    for (let i = 0; i < gates.length; i++) {
      gates[i]!.resolve({ thumbnail });
      if (i < gates.length - 2)
        await vi.waitFor(() => expect(processImage).toHaveBeenCalledTimes(i + 3));
    }
    expect((await Promise.all(tasks)).every((blob) => blob === thumbnail)).toBe(true);
    expect(maximum).toBe(2);
    expect((await items[0]!.storage.preview(items[0]!.record)).size).toBe(thumbnail.size);
    expect(processImage).toHaveBeenCalledTimes(5);
  });

  it("releases a failed slot and supports retry after an original is repaired", async () => {
    const queue = createPreviewQueue(1),
      calls: string[] = [];
    const failure = queue(async () => {
      calls.push("failed");
      throw new Error("bad preview");
    });
    const next = queue(async () => {
      calls.push("next");
      return "ok";
    });
    await expect(failure).rejects.toThrow("bad preview");
    expect(await next).toBe("ok");
    expect(calls).toEqual(["failed", "next"]);
    const { storage, record, binary } = await original(new MemoryStore(), 10);
    await binary.put(`artifacts/${attachmentPath(record.hash)}`, new Uint8Array());
    await expect(storage.preview(record)).rejects.toThrow("文件长度不符");
    await storage.put(record, new Blob([new Uint8Array([10])]));
    processImage.mockRejectedValueOnce(new Error("decoder interrupted"));
    await expect(storage.preview(record)).rejects.toThrow("interrupted");
    processImage.mockResolvedValueOnce({ thumbnail: new Blob(["repaired"]) });
    expect((await storage.preview(record)).size).toBe(8);
  });
});

describe("preview visibility", () => {
  it("waits for a nearby image, observes its scroll container, and only activates once", () => {
    let notify!: IntersectionObserverCallback;
    const root = {} as Element,
      element = { closest: () => root } as unknown as Element;
    const disconnect = vi.fn(),
      observe = vi.fn(),
      shown = vi.fn(),
      construct = vi.fn();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit) {
          notify = callback;
          construct(options);
        }
        observe = observe;
        disconnect = disconnect;
      },
    );
    const cleanup = observePreviewVisibility(element, shown);
    expect(observe).toHaveBeenCalledWith(element);
    expect(construct).toHaveBeenCalledWith({ root, rootMargin: "600px" });
    const entry = (isIntersecting: boolean) =>
      [{ target: element, isIntersecting }] as IntersectionObserverEntry[];
    notify(entry(false), {} as IntersectionObserver);
    expect(shown).not.toHaveBeenCalled();
    notify(entry(true), {} as IntersectionObserver);
    notify(entry(true), {} as IntersectionObserver);
    expect(shown).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("ignores callbacks after unmount and falls back when observers are unsupported", () => {
    let notify!: IntersectionObserverCallback;
    const element = { closest: () => null } as unknown as Element,
      shown = vi.fn();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          notify = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    observePreviewVisibility(element, shown)();
    notify(
      [{ target: element, isIntersecting: true }] as IntersectionObserverEntry[],
      {} as IntersectionObserver,
    );
    expect(shown).not.toHaveBeenCalled();
    vi.stubGlobal("IntersectionObserver", undefined);
    observePreviewVisibility(element, shown)();
    expect(shown).toHaveBeenCalledTimes(1);
  });
});
