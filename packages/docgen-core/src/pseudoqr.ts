/**
 * 装饰性伪 QR 码（decorative pseudo-QR — NOT scannable）。
 *
 * 它只是模仿 QR 视觉特征：三个角的 7×7 定位图案 + 由 seed 哈希驱动的
 * 确定性格点。不实现任何 Reed-Solomon / 掩码 / 格式信息，扫码枪读不出内容。
 * 同 seed → 同图案（纯确定性）。
 */

import { fnv1a, mulberry32 } from "./hash";

export const PSEUDO_QR_SIZE = 25;

/** 生成 25×25 布尔矩阵：true = 深色格 */
export function pseudoQrMatrix(seed: string): boolean[][] {
  const n = PSEUDO_QR_SIZE;
  const rng = mulberry32(fnv1a(`pseudoqr::${seed}`));
  const grid: boolean[][] = Array.from({ length: n }, () => Array.from({ length: n }, () => false));

  const inFinder = (x: number, y: number): boolean =>
    (x < 8 && y < 8) || (x >= n - 8 && y < 8) || (x < 8 && y >= n - 8);

  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (inFinder(x, y)) continue;
      const row = grid[y];
      if (row === undefined) continue;
      // 密度略高于 50% 更接近真实 QR 观感
      row[x] = rng() < 0.52;
    }
  }

  const drawFinder = (ox: number, oy: number): void => {
    for (let dy = -1; dy <= 7; dy++) {
      for (let dx = -1; dx <= 7; dx++) {
        const x = ox + dx;
        const y = oy + dy;
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        const row = grid[y];
        if (row === undefined) continue;
        if (dx < 0 || dy < 0 || dx > 6 || dy > 6) {
          row[x] = false; // 分隔带
          continue;
        }
        const ring = dx === 0 || dy === 0 || dx === 6 || dy === 6;
        const core = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4;
        row[x] = ring || core;
      }
    }
  };
  drawFinder(0, 0);
  drawFinder(n - 7, 0);
  drawFinder(0, n - 7);
  return grid;
}

export interface PseudoQrSvgOptions {
  /** 单格边长 px */
  readonly module: number;
  /** 静区格数 */
  readonly margin?: number;
  readonly color?: string;
  readonly background?: string;
}

/** 渲染为内联 SVG 字符串 */
export function pseudoQrSvg(seed: string, opts: PseudoQrSvgOptions): string {
  const grid = pseudoQrMatrix(seed);
  const margin = opts.margin ?? 2;
  const m = opts.module;
  const n = PSEUDO_QR_SIZE;
  const size = (n + margin * 2) * m;
  const color = opts.color ?? "#101418";
  const background = opts.background ?? "#ffffff";
  const rects: string[] = [`<rect width="${size}" height="${size}" fill="${background}"/>`];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (grid[y]?.[x] === true) {
        rects.push(
          `<rect x="${(x + margin) * m}" y="${(y + margin) * m}" width="${m}" height="${m}" fill="${color}"/>`,
        );
      }
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
    `viewBox="0 0 ${size} ${size}" role="img" aria-label="decorative qr">` +
    rects.join("") +
    `</svg>`
  );
}
