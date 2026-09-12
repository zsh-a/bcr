import { mulberry32 as randomSequence } from "./hash";
import type { PaperShape } from "./photo-options";
import type { ImageSize as PhotoSize } from "@bcr/scene-renderer";

export const PAPER_THICKNESS = 0.0001;

export interface PaperSurface {
  readonly positions: Float32Array;
  readonly uvs: Float32Array;
  readonly indices: Uint32Array;
  /** Counterclockwise perimeter, for a continuous sheet edge. */
  readonly boundary: readonly number[];
}

/** Smooth, nonintersecting height field. UVs stay attached to the printed page. */
export function createPaperSurface(size: PhotoSize, shape: PaperShape, seed: number): PaperSurface {
  const columns = Math.max(12, Math.round((72 * size.width) / Math.max(size.width, size.height)));
  const rows = Math.max(12, Math.round((72 * size.height) / Math.max(size.width, size.height)));
  const positions = new Float32Array((columns + 1) * (rows + 1) * 3);
  const uvs = new Float32Array((columns + 1) * (rows + 1) * 2);
  const indices: number[] = [];
  const rng = randomSequence(seed);
  const curl = 0.0025 + rng() * 0.002;
  const fold = 0.39 + rng() * 0.16;
  const phase = rng() * Math.PI;
  const strength = shape === "flat" ? 0 : shape === "folded" ? 1.6 : 0.65;

  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= columns; i++) {
      const u = i / columns;
      const v = j / rows;
      const index = j * (columns + 1) + i;
      const corner = curl * Math.exp(-((1 - u) ** 2 / 0.035 + v ** 2 / 0.065));
      const bow = 0.0012 * Math.sin(Math.PI * u) ** 2 * (0.3 + 0.7 * v);
      const wave = 0.00035 * (Math.sin(u * 7 + v * 5 + phase) + 1);
      const crease =
        shape === "folded"
          ? 0.0018 * Math.exp(-(((v - fold + (u - 0.5) * 0.035) / 0.018) ** 2))
          : 0;
      positions.set(
        [
          (u - 0.5) * size.width,
          (v - 0.5) * size.height,
          PAPER_THICKNESS + 0.00008 + strength * (corner + bow + wave + crease),
        ],
        index * 3,
      );
      uvs.set([u, v], index * 2);
      if (i < columns && j < rows) {
        const a = index;
        const b = index + 1;
        const c = index + columns + 1;
        indices.push(a, b, c, b, c + 1, c);
      }
    }
  }
  const boundary: number[] = [];
  for (let i = 0; i < columns; i++) boundary.push(i);
  for (let j = 0; j < rows; j++) boundary.push(j * (columns + 1) + columns);
  for (let i = columns; i > 0; i--) boundary.push(rows * (columns + 1) + i);
  for (let j = rows; j > 0; j--) boundary.push(j * (columns + 1));
  return { positions, uvs, indices: new Uint32Array(indices), boundary };
}
