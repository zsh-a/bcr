import { expect, it } from "vitest";
import { unpackRgba } from "../src/readback";

it("removes 256-byte GPU row padding at nonaligned export widths", () => {
  for (const width of [65, 258, 900, 1200, 1620]) {
    const stride = Math.ceil((width * 4) / 256) * 256;
    const pixels = new Uint8Array(stride * 2 + width * 4).fill(99);
    for (let row = 0; row < 3; row++) pixels.fill(row + 1, row * stride, row * stride + width * 4);
    const rgba = unpackRgba(pixels, { width, height: 3 }, "webgpu");
    expect(rgba.length).toBe(width * 3 * 4);
    for (let row = 0; row < 3; row++)
      expect(rgba.slice(row * width * 4, (row + 1) * width * 4).every((n) => n === row + 1)).toBe(
        true,
      );
  }
});

it("flips WebGL rows, preserves packed GPU rows, and rejects truncated input", () => {
  const pixels = new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]);
  expect([...unpackRgba(pixels, { width: 1, height: 2 }, "webgl")]).toEqual([
    0, 0, 255, 255, 255, 0, 0, 255,
  ]);
  expect([...unpackRgba(pixels, { width: 1, height: 2 }, "webgpu")]).toEqual([...pixels]);
  expect(() => unpackRgba(new Uint8Array(3), { width: 1, height: 2 }, "webgpu")).toThrow(
    "Incomplete",
  );
});
