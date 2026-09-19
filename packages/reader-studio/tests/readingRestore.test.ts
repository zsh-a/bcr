import { afterEach, describe, expect, it, vi } from "vitest";
import { settleReaderLayout } from "../src/readingRestore";

afterEach(() => vi.unstubAllGlobals());
function environment() {
  const frames = new Map<number, FrameRequestCallback>();
  let sequence = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++sequence, callback);
    return sequence;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  const container = Object.assign(new EventTarget(), {
    isConnected: true,
    clientWidth: 400,
    clientHeight: 800,
    scrollWidth: 400,
    scrollHeight: 2000,
    scrollTop: 0,
    scrollLeft: 0,
  }) as unknown as HTMLElement;
  const flush = () => {
    const pending = [...frames.values()];
    frames.clear();
    for (const frame of pending) frame(0);
  };
  return { container, flush, frames };
}

describe("reading layout transactions", () => {
  it("checks stable geometry before completing", () => {
    const { container, flush, frames } = environment();
    const settled = vi.fn();
    const apply = vi.fn(() => {
      container.scrollTop = 240;
    });
    settleReaderLayout(container, apply, settled);
    for (let index = 0; index < 3; index++) flush();
    expect(settled).not.toHaveBeenCalled();
    flush();
    expect(settled).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);
  });
  it("immediately yields ownership to gestures and cancels queued work", () => {
    const { container, flush, frames } = environment();
    const apply = vi.fn();
    const settled = vi.fn();
    settleReaderLayout(container, apply, settled);
    container.dispatchEvent(new Event("wheel"));
    flush();
    expect(apply).not.toHaveBeenCalled();
    expect(settled).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);
    const cancel = settleReaderLayout(container, apply);
    cancel();
    flush();
    expect(apply).not.toHaveBeenCalled();
  });
});
