import type { PixelImage } from "@bcr/scene-renderer";
import { mulberry32 } from "./hash";
import type { PhotoScene } from "./photo-options";

function noiseField(seed: number) {
  const field = Float32Array.from({ length: 64 * 64 }, mulberry32(seed));
  const smooth = (t: number): number => t * t * (3 - 2 * t);
  return (x: number, y: number, periodX: number, periodY: number): number => {
    const at = (i: number, j: number): number =>
      field[(((j % periodY) + periodY) % periodY) * 64 + (((i % periodX) + periodX) % periodX)]!;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const u = smooth(x - ix);
    const v = smooth(y - iy);
    return (
      (at(ix, iy) * (1 - u) + at(ix + 1, iy) * u) * (1 - v) +
      (at(ix, iy + 1) * (1 - u) + at(ix + 1, iy + 1) * u) * v
    );
  };
}

/** Neutral surface data: no reference-document text or baked illumination. */
export function paperBump(seed: number): PixelImage {
  const size = 256;
  const data = new Uint8Array(size * size * 4);
  const noise = noiseField(seed);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fiber =
        noise((x / size) * 32, (y / size) * 64, 32, 64) * 0.7 +
        noise((x / size) * 64, (y / size) * 32, 64, 32) * 0.3;
      const value = Math.round(110 + fiber * 36);
      data.set([value, value, value, 255], (y * size + x) * 4);
    }
  }
  return { data, width: size, height: size };
}

export function deskTexture(scene: PhotoScene, seed: number): PixelImage {
  const size = 512;
  const data = new Uint8Array(size * size * 4);
  const noise = noiseField(seed ^ 0x4ea3);
  const base =
    scene === "warm" ? [112, 88, 65] : scene === "studio" ? [162, 168, 171] : [166, 152, 131];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const broad = noise(u * 8, v * 8, 8, 8) - 0.5;
      const grain =
        scene === "studio"
          ? (noise(u * 64, v * 64, 64, 64) - 0.5) * 0.035
          : (noise(u * 4 + broad * 0.7, v * 64, 4, 64) - 0.5) * 0.09;
      const tone = 1 + broad * 0.075 + grain;
      data.set([base[0]! * tone, base[1]! * tone, base[2]! * tone, 255], (y * size + x) * 4);
    }
  }
  return { data, width: size, height: size };
}
