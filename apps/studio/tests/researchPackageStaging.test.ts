import { afterEach, describe, expect, it, vi } from "vitest";
import { contentHash } from "@bcr/core";
import { createPackageStaging, IMPORT_MEMORY_LIMIT } from "../src/researchPackageStaging";
afterEach(() => vi.unstubAllGlobals());
const bytes = new TextEncoder().encode("staged source");
const extract = (stream: WritableStream<Uint8Array>) => new Blob([bytes]).stream().pipeTo(stream);
describe("package staging", () => {
  it("validates streamed contents and rejects memory fallback above its budget before extraction", async () => {
    vi.stubGlobal("navigator", {});
    const staging = await createPackageStaging();
    expect(await (await staging.write(bytes.length, contentHash(bytes), extract)).text()).toBe(
      "staged source",
    );
    const read = vi.fn(extract);
    await expect(staging.write(IMPORT_MEMORY_LIMIT, contentHash(bytes), read)).rejects.toThrow(
      "32 MiB",
    );
    expect(read).not.toHaveBeenCalled();
    await staging.dispose();
  });
  it("rejects hash mismatches and decompressed data exceeding the declared size", async () => {
    vi.stubGlobal("navigator", {});
    const staging = await createPackageStaging();
    await expect(staging.write(bytes.length, "0".repeat(64), extract)).rejects.toThrow("哈希");
    await expect(staging.write(1, contentHash(bytes), extract)).rejects.toThrow("大小");
    await staging.dispose();
  });
  it("honors cancellation and prevents reusing a released preview", async () => {
    vi.stubGlobal("navigator", {});
    const controller = new AbortController();
    const staging = await createPackageStaging(controller.signal);
    controller.abort();
    await expect(staging.write(bytes.length, contentHash(bytes), extract)).rejects.toMatchObject({
      name: "AbortError",
    });
    await staging.dispose();
    expect(() => staging.acquire()).toThrow("已释放");
  });
});
