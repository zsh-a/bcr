import type { ImageSize, RendererBackend } from "./types";

/** Normalize WebGPU row padding and WebGL's bottom-up origin to Canvas RGBA. */
export function unpackRgba(
  pixels: Uint8Array,
  size: ImageSize,
  backend: RendererBackend,
): Uint8ClampedArray<ArrayBuffer> {
  const rowBytes = size.width * 4;
  const sourceStride =
    pixels.length === rowBytes * size.height ? rowBytes : Math.ceil(rowBytes / 256) * 256;
  if (pixels.length < (size.height - 1) * sourceStride + rowBytes)
    throw new Error("Incomplete GPU readback");
  const output = new Uint8ClampedArray(rowBytes * size.height);
  for (let y = 0; y < size.height; y++) {
    const row = backend === "webgl" ? size.height - 1 - y : y;
    output.set(pixels.subarray(row * sourceStride, row * sourceStride + rowBytes), y * rowBytes);
  }
  return output;
}
