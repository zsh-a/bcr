import { afterEach, describe, expect, it, vi } from "vitest";
import { createReaderRuntime } from "../src/readerRuntimeCore";
import { closeReaderRuntime, persistReaderSnapshot } from "../src/readerPersistenceQueue";
import { reader } from "../src/store";
import { createDemoBook, DEFAULT_READER_SETTINGS } from "../src/model";

afterEach(() => vi.unstubAllGlobals());

describe("Reader writer ownership", () => {
  it("keeps the lease through final persistence, blocks late mirrors, and allows reopening", async () => {
    let held = false;
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", {
      locks: {
        request: async (
          _name: string,
          _options: unknown,
          callback: (lock: object | null) => Promise<void>,
        ) => {
          if (held) return callback(null);
          held = true;
          try {
            await callback({});
          } finally {
            held = false;
          }
        },
      },
    });
    const local = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => local.get(key) ?? null,
      setItem: (key: string, value: string) => {
        local.set(key, value);
      },
    });
    const runtime = await createReaderRuntime();
    reader.hydrate([createDemoBook()], {}, DEFAULT_READER_SETTINGS);
    await expect(createReaderRuntime()).rejects.toThrow("其他页面");
    let release!: () => void;
    let entered!: () => void;
    const writing = new Promise<void>((done) => {
      entered = done;
    });
    const blocked = new Promise<void>((done) => {
      release = done;
    });
    runtime.meta = {
      kvSet: async () => {
        entered();
        await blocked;
      },
      close: async () => {},
    } as never;
    const closing = closeReaderRuntime(runtime);
    await writing;
    await expect(createReaderRuntime()).rejects.toThrow("其他页面");
    const mirror = local.get("bcr.reader.session.v1");
    reader.setSettings({ fontSize: 28 });
    await expect(persistReaderSnapshot(runtime, { strict: true })).rejects.toThrow("不可写");
    expect(local.get("bcr.reader.session.v1")).toBe(mirror);
    release();
    await closing;
    expect(held).toBe(false);
    const reopened = await createReaderRuntime();
    await reopened.dispose?.();
    expect(held).toBe(false);
  });
});
