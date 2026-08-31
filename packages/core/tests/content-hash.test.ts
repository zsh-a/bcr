import { describe, expect, it } from "vitest";
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
});
