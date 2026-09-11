/**
 * 「实拍」合成：把账单位图贴到程序化生成的深色木桌面上。
 * - 桌面：base 渐变 + 水平板材分割线 + 固定 seed 噪点（ImageData）+ 四角暗角
 * - 账单：四角单应映射到略微旋转/透视的四边形，
 *   用 24×24 网格细分（每格两个三角形的仿射近似）实现平滑 warp
 * - 先画高斯模糊投影四边形，再贴账单，账单上叠轻噪点 + 0.5px 级模糊
 * 输出约 1620×2160 JPEG。纯端侧，确定性（固定 seed）。
 */

import { mulberry32 } from "./hash";

export const PHOTO_WIDTH = 1620;
export const PHOTO_HEIGHT = 2160;

interface Pt {
  x: number;
  y: number;
}

type Quad = [Pt, Pt, Pt, Pt]; // tl, tr, br, bl

/** Wolberg 单位正方形 → 任意四边形单应映射 */
function squareToQuad(q: Quad): (u: number, v: number) => Pt {
  const [tl, tr, br, bl] = q;
  const dx1 = tr.x - br.x;
  const dx2 = bl.x - br.x;
  const dy1 = tr.y - br.y;
  const dy2 = bl.y - br.y;
  const sx = tl.x - tr.x + br.x - bl.x;
  const sy = tl.y - tr.y + br.y - bl.y;
  const den = dx1 * dy2 - dx2 * dy1;
  const a13 = den === 0 ? 0 : (sx * dy2 - dx2 * sy) / den;
  const a23 = den === 0 ? 0 : (dx1 * sy - sx * dy1) / den;
  const a11 = tr.x - tl.x + a13 * tr.x;
  const a21 = tr.y - tl.y + a13 * tr.y;
  const a12 = bl.x - tl.x + a23 * bl.x;
  const a22 = bl.y - tl.y + a23 * bl.y;
  return (u, v) => {
    const d = a13 * u + a23 * v + 1;
    return {
      x: (a11 * u + a12 * v + tl.x) / d,
      y: (a21 * u + a22 * v + tl.y) / d,
    };
  };
}

/** 由源三角形 → 目标三角形求仿射变换并绘制（clip 略微外扩避免接缝） */
function drawTriangle(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  src: [Pt, Pt, Pt],
  dst: [Pt, Pt, Pt],
): void {
  const [s0, s1, s2] = src;
  const [d0, d1, d2] = dst;
  const den = s0.x * (s1.y - s2.y) + s1.x * (s2.y - s0.y) + s2.x * (s0.y - s1.y);
  if (den === 0) return;
  const a = (d0.x * (s1.y - s2.y) + d1.x * (s2.y - s0.y) + d2.x * (s0.y - s1.y)) / den;
  const b = (d0.y * (s1.y - s2.y) + d1.y * (s2.y - s0.y) + d2.y * (s0.y - s1.y)) / den;
  const c = (d0.x * (s2.x - s1.x) + d1.x * (s0.x - s2.x) + d2.x * (s1.x - s0.x)) / den;
  const d = (d0.y * (s2.x - s1.x) + d1.y * (s0.x - s2.x) + d2.y * (s1.x - s0.x)) / den;
  const e =
    (d0.x * (s1.x * s2.y - s2.x * s1.y) +
      d1.x * (s2.x * s0.y - s0.x * s2.y) +
      d2.x * (s0.x * s1.y - s1.x * s0.y)) /
    den;
  const f =
    (d0.y * (s1.x * s2.y - s2.x * s1.y) +
      d1.y * (s2.x * s0.y - s0.x * s2.y) +
      d2.y * (s0.x * s1.y - s1.x * s0.y)) /
    den;

  // clip 三角形沿质心外扩 ~1px，掩盖相邻子块的接缝
  const cx = (d0.x + d1.x + d2.x) / 3;
  const cy = (d0.y + d1.y + d2.y) / 3;
  const grow = (p: Pt): Pt => {
    const vx = p.x - cx;
    const vy = p.y - cy;
    const len = Math.hypot(vx, vy) || 1;
    return { x: p.x + (vx / len) * 1.1, y: p.y + (vy / len) * 1.1 };
  };
  ctx.save();
  ctx.beginPath();
  const g0 = grow(d0);
  ctx.moveTo(g0.x, g0.y);
  const g1 = grow(d1);
  ctx.lineTo(g1.x, g1.y);
  const g2 = grow(d2);
  ctx.lineTo(g2.x, g2.y);
  ctx.closePath();
  ctx.clip();
  ctx.setTransform(a, b, c, d, e, f);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

function paintDesk(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  // 1) base 渐变：深胡桃木色
  const grad = ctx.createLinearGradient(0, 0, width * 0.3, height);
  grad.addColorStop(0, "#3d3128");
  grad.addColorStop(0.5, "#2e241c");
  grad.addColorStop(1, "#211a14");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // 2) 水平板材分割线 + 每板轻微亮度差（固定 seed）
  const rng = mulberry32(0xde5eed);
  const plankHeight = 264;
  for (let y = 0; y < height; y += plankHeight) {
    const tone = (rng() - 0.5) * 0.1;
    ctx.fillStyle =
      tone >= 0 ? `rgba(255,240,220,${tone.toFixed(3)})` : `rgba(0,0,0,${(-tone).toFixed(3)})`;
    ctx.fillRect(0, y, width, plankHeight);
    ctx.fillStyle = "rgba(0,0,0,0.38)";
    ctx.fillRect(0, y, width, 3);
    ctx.fillStyle = "rgba(255,235,210,0.05)";
    ctx.fillRect(0, y + 3, width, 2);
    // 每板的木纹横丝
    for (let i = 0; i < 7; i++) {
      const gy = y + 14 + rng() * (plankHeight - 28);
      ctx.fillStyle = `rgba(0,0,0,${(0.03 + rng() * 0.05).toFixed(3)})`;
      ctx.fillRect(0, gy, width, 1 + rng() * 2);
    }
  }

  // 3) 固定 seed 噪点（ImageData 逐像素微调亮度）
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const noiseRng = mulberry32(0xc0ffee);
  for (let i = 0; i < data.length; i += 4) {
    const n = (noiseRng() - 0.5) * 14;
    data[i] = Math.max(0, Math.min(255, (data[i] ?? 0) + n));
    data[i + 1] = Math.max(0, Math.min(255, (data[i + 1] ?? 0) + n));
    data[i + 2] = Math.max(0, Math.min(255, (data[i + 2] ?? 0) + n));
  }
  ctx.putImageData(imageData, 0, 0);

  // 4) 四角暗角
  const vignette = ctx.createRadialGradient(
    width / 2,
    height / 2,
    Math.min(width, height) * 0.35,
    width / 2,
    height / 2,
    Math.hypot(width, height) * 0.62,
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.52)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
}

/** 账单目标四边形：居中 + 约 -2.4° 旋转 + 轻微透视（上窄下宽、微微倾斜） */
function billQuad(width: number, height: number, sourceWidth: number, sourceHeight: number): Quad {
  const bw = 1050;
  const bh = Math.round((bw * sourceHeight) / sourceWidth);
  const cx = width / 2 + 20;
  const cy = height / 2 + 30;
  const angle = (-2.4 * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const corners: Quad = [
    { x: -bw / 2, y: -bh / 2 },
    { x: bw / 2, y: -bh / 2 },
    { x: bw / 2, y: bh / 2 },
    { x: -bw / 2, y: bh / 2 },
  ];
  const rotated = corners.map((p) => ({
    x: cx + p.x * cos - p.y * sin,
    y: cy + p.x * sin + p.y * cos,
  })) as Quad;
  // 透视：顶边向中线收 3.2%，底边外放 2.4%，整体向右下微倾
  const pinch = (p: Pt, factor: number): Pt => ({ x: cx + (p.x - cx) * factor, y: p.y });
  const [tl, tr, br, bl] = rotated;
  return [
    { x: pinch(tl, 0.968).x + 14, y: tl.y - 8 },
    { x: pinch(tr, 0.968).x - 6, y: tr.y + 4 },
    { x: pinch(br, 1.024).x + 2, y: br.y + 10 },
    { x: pinch(bl, 1.024).x - 12, y: bl.y - 4 },
  ];
}

function quadPath(ctx: CanvasRenderingContext2D, q: Quad): void {
  ctx.beginPath();
  const first = q[0];
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < q.length; i++) {
    const p = q[i];
    if (p !== undefined) ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
}

export async function compositePaperPhoto(bill: HTMLImageElement | ImageBitmap): Promise<Blob> {
  const width = PHOTO_WIDTH;
  const height = PHOTO_HEIGHT;
  const sw = bill instanceof HTMLImageElement ? bill.naturalWidth : bill.width;
  const sh = bill instanceof HTMLImageElement ? bill.naturalHeight : bill.height;
  if (sw === 0 || sh === 0) throw new Error("实拍合成失败：账单图像为空");

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("实拍合成失败：无法创建 2D 上下文");

  paintDesk(ctx, width, height);

  const quad = billQuad(width, height, sw, sh);

  // 1) 高斯模糊投影四边形（偏移右下）
  ctx.save();
  ctx.filter = "blur(40px)";
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  const shadowQuad = quad.map((p) => ({ x: p.x + 26, y: p.y + 44 })) as Quad;
  quadPath(ctx, shadowQuad);
  ctx.fill();
  ctx.restore();

  // 2) 账单 warp 到独立图层（24×24 网格细分，每格两个三角形仿射近似）
  const layer = document.createElement("canvas");
  layer.width = width;
  layer.height = height;
  const lctx = layer.getContext("2d");
  if (lctx === null) throw new Error("实拍合成失败：无法创建图层上下文");
  const project = squareToQuad(quad);
  const N = 24;
  const gridPt = (i: number, j: number): Pt => project(i / N, j / N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const s = (u: number, v: number): Pt => ({ x: (u / N) * sw, y: (v / N) * sh });
      const dTl = gridPt(i, j);
      const dTr = gridPt(i + 1, j);
      const dBr = gridPt(i + 1, j + 1);
      const dBl = gridPt(i, j + 1);
      drawTriangle(lctx, bill, [s(i, j), s(i + 1, j), s(i, j + 1)], [dTl, dTr, dBl]);
      drawTriangle(lctx, bill, [s(i + 1, j), s(i + 1, j + 1), s(i, j + 1)], [dTr, dBr, dBl]);
    }
  }

  // 3) 账单图层上叠轻噪点 + 顶部轻微环境光
  lctx.save();
  quadPath(lctx, quad);
  lctx.clip();
  const noiseRng = mulberry32(0xbeef);
  for (let i = 0; i < 4200; i++) {
    const nx = noiseRng() * width;
    const ny = noiseRng() * height;
    lctx.fillStyle = `rgba(${noiseRng() > 0.5 ? "255,255,255" : "0,0,0"},${(0.02 + noiseRng() * 0.05).toFixed(3)})`;
    lctx.fillRect(nx, ny, 1 + noiseRng() * 2.2, 1 + noiseRng() * 2.2);
  }
  const glare = lctx.createLinearGradient(0, quad[0].y, 0, quad[2].y);
  glare.addColorStop(0, "rgba(255,246,230,0.10)");
  glare.addColorStop(0.45, "rgba(255,246,230,0.02)");
  glare.addColorStop(1, "rgba(20,10,0,0.10)");
  lctx.fillStyle = glare;
  lctx.fillRect(0, 0, width, height);
  lctx.restore();

  // 4) 0.5px 级模糊后贴回主画布（模拟相机景深/对焦）
  ctx.save();
  ctx.filter = "blur(0.6px)";
  ctx.drawImage(layer, 0, 0);
  ctx.restore();

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob === null ? reject(new Error("实拍合成失败：canvas.toBlob 返回 null")) : resolve(blob),
      "image/jpeg",
      0.92,
    );
  });
}
