import { afterEach, describe, expect, it } from "vitest";
import {
  clearMangaModelCache,
  configureMangaTransformersCache,
  inspectMangaModelCache,
  MANGA_MODEL_CACHE_NAME,
} from "../src/model-cache";

const originalCaches = (globalThis as typeof globalThis & { caches?: CacheStorage }).caches;

afterEach(async () => {
  await clearMangaModelCache();
  if (originalCaches === undefined) {
    Reflect.deleteProperty(globalThis, "caches");
  } else {
    Object.defineProperty(globalThis, "caches", {
      configurable: true,
      value: originalCaches,
    });
  }
});

describe("Manga model Cache API boundary", () => {
  it("falls back cleanly when Cache API is unavailable", async () => {
    Reflect.deleteProperty(globalThis, "caches");
    const environment = {
      useCustomCache: false,
      customCache: null,
      useBrowserCache: false,
      useFSCache: false,
    };
    expect(await configureMangaTransformersCache(environment)).toBe(false);
    expect(await inspectMangaModelCache(["example/model"])).toEqual({
      supported: false,
      entryCount: 0,
      modelFiles: [],
    });
  });

  it("uses a versioned namespace and counts files per model without reading bodies", async () => {
    const requests = [
      new Request("https://huggingface.co/Xenova/model/resolve/main/config.json"),
      new Request("https://huggingface.co/Xenova/model/resolve/main/model.onnx"),
      new Request("https://huggingface.co/other/model/resolve/main/tokenizer.json"),
    ];
    const cache = {
      keys: async () => requests,
      match: async () => undefined,
      put: async () => undefined,
    } as unknown as Cache;
    let opened = "";
    const storage = {
      open: async (name: string) => {
        opened = name;
        return cache;
      },
      delete: async () => true,
    } as unknown as CacheStorage;
    Object.defineProperty(globalThis, "caches", { configurable: true, value: storage });

    const environment = {
      useCustomCache: false,
      customCache: null,
      useBrowserCache: true,
      useFSCache: true,
    };
    expect(await configureMangaTransformersCache(environment)).toBe(true);
    expect(opened).toBe(MANGA_MODEL_CACHE_NAME);
    expect(environment.useCustomCache).toBe(true);
    expect(environment.useBrowserCache).toBe(false);
    expect(environment.useFSCache).toBe(false);
    expect(await inspectMangaModelCache(["Xenova/model", "other/model"])).toEqual({
      supported: true,
      entryCount: 3,
      modelFiles: [
        { model: "Xenova/model", files: 2 },
        { model: "other/model", files: 1 },
      ],
    });
  });
});
