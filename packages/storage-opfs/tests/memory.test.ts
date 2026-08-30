import { describe, expect, it } from "vitest";
import { MemoryStore } from "../src/memory";

function streamOf(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

describe("MemoryStore (BinaryStore 契约)", () => {
  it("put / get / has / delete", async () => {
    const store = new MemoryStore();
    expect(await store.has("a")).toBe(false);

    await store.put("a", new Uint8Array([1, 2, 3]));
    expect(await store.has("a")).toBe(true);
    expect([...(await store.get("a"))!]).toEqual([1, 2, 3]);

    await store.delete("a");
    expect(await store.has("a")).toBe(false);
    expect(await store.get("a")).toBeUndefined();
  });

  it("get 返回副本，外部修改不影响存储", async () => {
    const store = new MemoryStore();
    await store.put("a", new Uint8Array([1]));
    (await store.get("a"))![0] = 99;
    expect([...(await store.get("a"))!]).toEqual([1]);
  });

  it("流式读写（§4 大对象通道）", async () => {
    const store = new MemoryStore();
    await store.putStream("big", streamOf(new Uint8Array([1, 2]), new Uint8Array([3])));
    const stream = await store.getStream("big");
    expect(stream).toBeDefined();
    const reader = stream!.getReader();
    const chunks: number[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(...value);
    }
    expect(chunks).toEqual([1, 2, 3]);
  });

  it("readRange 按窗口读取", async () => {
    const store = new MemoryStore();
    await store.put("f", new Uint8Array([0, 1, 2, 3, 4]));
    expect([...(await store.readRange("f", 1, 3))]).toEqual([1, 2, 3]);
    expect([...(await store.readRange("f", 3, 10))]).toEqual([3, 4]);
  });

  it("list 按前缀过滤", async () => {
    const store = new MemoryStore();
    await store.put("artifacts/a", new Uint8Array());
    await store.put("artifacts/b", new Uint8Array());
    await store.put("cache/c", new Uint8Array());
    expect((await store.list("artifacts/")).sort()).toEqual(["artifacts/a", "artifacts/b"]);
    expect((await store.list()).sort()).toEqual(["artifacts/a", "artifacts/b", "cache/c"]);
  });
});
