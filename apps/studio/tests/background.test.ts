import { describe, expect, it, vi } from "vitest";
import {
  BACKGROUND_LIMIT,
  createBackgroundStore,
  decodeBackground,
  prepareBackground,
} from "../src/theme/background";

const value = { image: "data:image/webp;base64,AAAA", name: "photo.webp", shade: 65 };
describe("custom background", () => {
  it("validates local images and strips unexpected fields", () => {
    expect(decodeBackground(null)).toBeNull();
    expect(decodeBackground(JSON.stringify({ ...value, extra: "ignored" }))).toEqual(value);
  });
  it.each([
    { image: "https://example.com/photo.png" },
    { image: "data:image/svg+xml;base64,AAAA" },
    { image: 'data:image/webp;base64,AAAA");url(https://example.com)' },
    { image: "data:image/webp;base64," },
    { shade: 0 },
    { shade: 100 },
    { shade: "65" },
    { name: "a".repeat(201) },
    { image: "a".repeat(BACKGROUND_LIMIT + 1) },
  ])("rejects invalid settings", (override) => {
    expect(() => decodeBackground(JSON.stringify({ ...value, ...override }))).toThrow();
  });
  it("keeps the previous background when saving or deleting fails", () => {
    let raw: string | null = JSON.stringify(value),
      fail = false;
    const apply = vi.fn();
    const store = createBackgroundStore({
      read: () => raw,
      write: (next) => {
        if (fail) throw Error("quota");
        raw = next;
      },
      apply,
    });
    expect(store.getSnapshot().value).toEqual(value);
    fail = true;
    expect(store.save({ ...value, shade: 90 })).toBe(false);
    expect(store.save(null)).toBe(false);
    expect(store.getSnapshot().value).toEqual(value);
    expect(store.getSnapshot().error).toContain("原设置已保留");
    fail = false;
    expect(store.save(null)).toBe(true);
    expect(raw).toBeNull();
    expect(apply).toHaveBeenLastCalledWith(null);
  });
  it("handles broken storage and cross-tab updates without overwriting data", () => {
    let raw: string | null = "broken";
    const write = vi.fn(),
      listener = vi.fn();
    const store = createBackgroundStore({ read: () => raw, write, apply: vi.fn() });
    expect(store.getSnapshot().error).toContain("无法恢复");
    expect(write).not.toHaveBeenCalled();
    const dispose = store.subscribe(listener);
    raw = JSON.stringify(value);
    store.reload();
    expect(store.getSnapshot().value).toEqual(value);
    expect(listener).toHaveBeenCalledOnce();
    dispose();
    listener.mockClear();
    raw = null;
    store.reload();
    expect(store.getSnapshot().value).toBeNull();
    expect(listener).not.toHaveBeenCalled();
  });
  it("rejects unsupported and oversized input before decoding", async () => {
    await expect(
      prepareBackground(new File(["svg"], "image.svg", { type: "image/svg+xml" })),
    ).rejects.toThrow("JPG");
    await expect(
      prepareBackground(new File(["<svg />"], "fake.png", { type: "image/png" })),
    ).rejects.toThrow("文件内容");
    await expect(
      prepareBackground(
        new File([new Uint8Array(11 * 1024 * 1024)], "big.png", { type: "image/png" }),
      ),
    ).rejects.toThrow("10 MB");
  });
});
