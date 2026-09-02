import type { SqliteDb } from "@bcr/storage-sqlite";
import { describe, expect, it } from "vitest";
import { MangaModelRegistry, mangaModelCatalog, modelKeyForExecution } from "../src/model-registry";
import type { MangaAdapterExecution } from "../src/model";

function fakeDb(initial?: string): { db: SqliteDb; read: () => string | undefined } {
  let value = initial;
  const db = {
    run: () => undefined,
    all: () => [],
    value: () => undefined,
    persist: async () => undefined,
    close: async () => undefined,
    kvGet: async () => value,
    kvSet: async (_key: string, next: string) => {
      value = next;
    },
  } as unknown as SqliteDb;
  return { db, read: () => value };
}

const ocrExecution: MangaAdapterExecution = {
  kind: "ocr",
  requestedAdapter: "manga.onnx",
  effectiveAdapter: "manga.onnx",
  runtime: "wasm",
  requestedDevice: "auto",
  effectiveDevice: "wasm",
  model: "onnx-community/manga-ocr-base-ONNX",
  sourceLanguage: "ja",
};

describe("Manga model registry", () => {
  it("derives stable keys from manifests and persists lifecycle facts", async () => {
    const catalog = mangaModelCatalog();
    expect(catalog.some((entry) => entry.model === ocrExecution.model)).toBe(true);
    const key = modelKeyForExecution(ocrExecution);
    expect(key).toBe("ocr:onnx-community/manga-ocr-base-ONNX");

    const storage = fakeDb();
    const registry = new MangaModelRegistry(storage.db);
    await registry.markLoading(ocrExecution);
    expect(registry.getSnapshot().records[0]).toMatchObject({ status: "loading", key });
    await registry.markReady(ocrExecution, 1234);
    expect(registry.getSnapshot().records[0]).toMatchObject({
      status: "ready",
      lastLoadDurationMs: 1234,
    });
    expect(storage.read()).toContain("manga-ocr-base-ONNX");

    const restored = new MangaModelRegistry(storage.db);
    await restored.restore();
    expect(restored.get(key ?? "")).toMatchObject({ status: "ready", model: ocrExecution.model });
  });

  it("records errors without blocking runtime restoration from corrupt metadata", async () => {
    const storage = fakeDb();
    const registry = new MangaModelRegistry(storage.db);
    await registry.markError(ocrExecution, new Error("download failed"));
    expect(registry.getSnapshot().records[0]).toMatchObject({
      status: "error",
      lastError: "download failed",
    });

    const corrupt = fakeDb('{"version":1,"records":[{"status":"error"}]}');
    const restored = new MangaModelRegistry(corrupt.db);
    await restored.restore();
    expect(restored.getSnapshot().records).toEqual([]);
  });
});
