import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "@bcr/storage-opfs";
import { publishQuantReference, receiveQuantReference } from "../src/handoff";
import { createDemoHistory, instrumentsFor, type QuantHandoff } from "../src";
const values = new Map<string, string>();
beforeEach(() => {
  values.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("navigator", {});
});
afterEach(() => vi.unstubAllGlobals());
function handoff(): QuantHandoff {
  const instrument = instrumentsFor("CN")[0]!;
  const history = createDemoHistory({ instrument, range: "1Y" });
  return {
    version: 1,
    instrument,
    range: "1Y",
    bars: history.bars,
    source: "explicit demo",
    createdAt: Date.now(),
  };
}
describe("OPFS reference handoff", () => {
  it("keeps arrays out of localStorage and acknowledges only after a successful import", async () => {
    const store = new MemoryStore(),
      data = handoff();
    await publishQuantReference(data, store);
    expect([...values.values()][0]!.length).toBeLessThan(150);
    expect([...values.values()][0]).not.toContain("bars");
    await expect(
      receiveQuantReference(async () => {
        throw new Error("persistence failed");
      }, store),
    ).rejects.toThrow("persistence failed");
    expect(values.size).toBe(1);
    expect(await store.list("handoffs/")).toHaveLength(1);
    const importer = vi.fn(async (value: QuantHandoff) => {
      expect(value).toEqual(data);
      expect(values.size).toBe(1);
    });
    expect(await receiveQuantReference(importer, store)).toBe(true);
    expect(importer).toHaveBeenCalledOnce();
    expect(values.size).toBe(0);
    expect(await store.list("handoffs/")).toHaveLength(0);
    expect(await receiveQuantReference(importer, store)).toBe(false);
  });
  it("rejects damaged data and retains the pending reference for recovery", async () => {
    const store = new MemoryStore();
    await publishQuantReference(handoff(), store);
    const path = (await store.list("handoffs/"))[0]!;
    await store.put(path, new Uint8Array([1, 2, 3]));
    const importer = vi.fn(async () => {});
    await expect(receiveQuantReference(importer, store)).rejects.toThrow("校验失败");
    expect(importer).not.toHaveBeenCalled();
    expect(values.size).toBe(1);
  });
});
