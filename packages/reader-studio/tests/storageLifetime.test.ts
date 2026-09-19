import { describe, expect, it } from "vitest";
import { MemoryStore } from "@bcr/storage-opfs";
import { readerStorageLifetime } from "../src/readerStorage";

describe("Reader storage lifetime", () => {
  it("drains accepted streams and rejects late writes before releasing ownership", async () => {
    const source = new MemoryStore();
    const storage = readerStorageLifetime(source);
    let finish!: () => void;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        finish = () => controller.close();
      },
    });
    const write = storage.binary.putStream("source", stream);
    let closed = false;
    const close = storage.close().then(() => {
      closed = true;
    });
    await expect(storage.binary.put("late", new Uint8Array([3]))).rejects.toThrow("已关闭");
    expect(closed).toBe(false);
    finish();
    await Promise.all([write, close]);
    expect(await source.get("source")).toEqual(new Uint8Array([1, 2]));
    expect(await source.has("late")).toBe(false);
    expect(storage.binary instanceof MemoryStore).toBe(true);
  });
  it("failed operations do not prevent shutdown", async () => {
    const storage = readerStorageLifetime(new MemoryStore());
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("read failed"));
      },
    });
    await expect(storage.binary.putStream("source", stream)).rejects.toThrow("read failed");
    await storage.close();
  });
});
