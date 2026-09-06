import { describe, expect, it, vi } from "vitest";
import { contentHash, hashReadableStream } from "../src/content-hash";

describe("contentHash", () => {
  it("分块流与一次性字节得到相同摘要", async () => {
    const bytes = new TextEncoder().encode("browser compute runtime");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 7));
        controller.enqueue(bytes.slice(7, 15));
        controller.enqueue(bytes.slice(15));
        controller.close();
      },
    });

    await expect(hashReadableStream(stream)).resolves.toBe(contentHash(bytes));
  });

  it("不同内容即使文件名相同也产生不同身份摘要", () => {
    const encoder = new TextEncoder();
    expect(contentHash(encoder.encode("version-a"))).not.toBe(
      contentHash(encoder.encode("version-b")),
    );
  });

  it("reports consumed bytes without changing the digest", async () => {
    const bytes = new Uint8Array(2 * 1024 * 1024 + 7).fill(23);
    const progress: number[] = [];
    expect(
      await hashReadableStream(new Blob([bytes]).stream(), {
        onProgress: (size) => progress.push(size),
      }),
    ).toBe(contentHash(bytes));
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(bytes.length);
    expect(progress.every((value, i) => !i || value > progress[i - 1]!)).toBe(true);
  });

  it("cancels a pending read, preserves the abort reason and releases the lock", async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const pending = hashReadableStream(stream, { signal: controller.signal });
    const reason = new Error("user cancelled");
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(cancel).toHaveBeenCalledWith(reason);
    expect(stream.locked).toBe(false);
  });

  it("does not hash a pre-aborted stream or return a partial digest", async () => {
    const controller = new AbortController();
    controller.abort();
    const progress = vi.fn(),
      cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    await expect(
      hashReadableStream(stream, { signal: controller.signal, onProgress: progress }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(progress).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(stream.locked).toBe(false);
  });

  it("stops hashing a buffered large chunk after cancellation", async () => {
    const controller = new AbortController();
    const stream = new ReadableStream<Uint8Array>({
      start(target) {
        target.enqueue(new Uint8Array(3 * 1024 * 1024));
        target.close();
      },
    });
    const progress: number[] = [];
    await expect(
      hashReadableStream(stream, {
        signal: controller.signal,
        onProgress: (bytes) => {
          progress.push(bytes);
          if (bytes) controller.abort();
        },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(progress.at(-1)).toBe(1024 * 1024);
    expect(stream.locked).toBe(false);
  });
});
