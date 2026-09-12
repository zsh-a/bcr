/**
 * 「实拍」合成：把账单位图贴到带纸张材质和环境光的桌面上。
 *
 * 纸面素材只作为低频光照参考；素材里原有的账单文字和 alpha 不会直接覆盖到
 * 生成的账单上，纸张边缘由独立的轻微扰动路径生成，避免不同国家模板串内容。
 */

import { mulberry32 } from "./hash";

export const PHOTO_WIDTH = 1620;
export const PHOTO_HEIGHT = 2160;

const PAPER_SURFACE_URL = new URL("./assets/paper-surface-map.png", import.meta.url).href;
let paperSurfacePromise: Promise<HTMLImageElement | null> | undefined;

function loadPaperSurface(): Promise<HTMLImageElement | null> {
  if (paperSurfacePromise !== undefined) return paperSurfacePromise;
  paperSurfacePromise = new Promise((resolve) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = PAPER_SURFACE_URL;
  });
  return paperSurfacePromise;
}

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
  // 1) base 渐变：保留深色桌面，但去掉一眼可见的规则色块。
  const grad = ctx.createRadialGradient(
    width * 0.3,
    height * 0.18,
    0,
    width * 0.48,
    height * 0.48,
    Math.hypot(width, height) * 0.82,
  );
  grad.addColorStop(0, "#655549");
  grad.addColorStop(0.42, "#40342b");
  grad.addColorStop(1, "#211914");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // 2) 大面积漫反射光斑，模拟木面上的不均匀环境光。
  const rng = mulberry32(0xde5eed);
  ctx.save();
  ctx.filter = "blur(74px)";
  for (let i = 0; i < 13; i++) {
    const x = rng() * width;
    const y = rng() * height;
    const radius = 180 + rng() * 420;
    const tone = rng() > 0.48 ? "255,235,212" : "0,0,0";
    const alpha = 0.018 + rng() * 0.038;
    const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
    glow.addColorStop(0, `rgba(${tone},${alpha.toFixed(3)})`);
    glow.addColorStop(1, `rgba(${tone},0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  ctx.restore();

  // 3) 柔和的木纹和板材接缝；曲线和低对比度避免出现“贴图网格感”。
  let seamY = 205 + rng() * 80;
  while (seamY < height) {
    ctx.save();
    ctx.filter = "blur(2.6px)";
    ctx.beginPath();
    ctx.moveTo(0, seamY);
    for (let x = 180; x <= width; x += 180) {
      ctx.lineTo(x, seamY + Math.sin(x / 145 + seamY / 91) * 3.5);
    }
    ctx.strokeStyle = "rgba(7,5,4,0.18)";
    ctx.lineWidth = 3.5;
    ctx.stroke();
    ctx.restore();

    for (let i = 0; i < 11; i++) {
      const y = seamY - 82 + rng() * 164;
      ctx.beginPath();
      ctx.moveTo(-20, y);
      for (let x = 160; x <= width + 20; x += 160) {
        ctx.lineTo(x, y + Math.sin(x / (38 + rng() * 55) + i) * (1 + rng() * 2.5));
      }
      ctx.strokeStyle = `rgba(${rng() > 0.45 ? "255,225,196" : "0,0,0"},${(
        0.012 + rng() * 0.025
      ).toFixed(3)})`;
      ctx.lineWidth = 0.6 + rng() * 1.4;
      ctx.stroke();
    }
    seamY += 310 + rng() * 100;
  }

  // 4) 固定 seed 噪点（ImageData 逐像素微调亮度）。
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const noiseRng = mulberry32(0xc0ffee);
  for (let i = 0; i < data.length; i += 4) {
    const n = (noiseRng() - 0.5) * 7;
    data[i] = Math.max(0, Math.min(255, (data[i] ?? 0) + n));
    data[i + 1] = Math.max(0, Math.min(255, (data[i + 1] ?? 0) + n));
    data[i + 2] = Math.max(0, Math.min(255, (data[i + 2] ?? 0) + n));
  }
  ctx.putImageData(imageData, 0, 0);

  // 5) 四角暗角：保留镜头感，但不压黑纸面。
  const vignette = ctx.createRadialGradient(
    width / 2,
    height / 2,
    Math.min(width, height) * 0.35,
    width / 2,
    height / 2,
    Math.hypot(width, height) * 0.62,
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.34)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
}

/** 账单目标四边形：居中 + 轻微旋转 + 真实纸张常见的透视和倾斜。 */
function billQuad(width: number, height: number, sourceWidth: number, sourceHeight: number): Quad {
  const maxWidth = Math.min(1140, width * 0.72);
  const maxHeight = height * 0.84;
  const scale = Math.min(1, maxHeight / ((maxWidth * sourceHeight) / sourceWidth));
  const bw = Math.round(maxWidth * scale);
  const bh = Math.round((bw * sourceHeight) / sourceWidth);
  const cx = width / 2 + 18;
  const cy = height / 2 + 22;
  const angle = (-1.8 * Math.PI) / 180;
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
  // 透视：顶边略窄、底边略宽，模拟手机从上方拍摄时的纸面变化。
  const pinch = (p: Pt, factor: number): Pt => ({ x: cx + (p.x - cx) * factor, y: p.y });
  const [tl, tr, br, bl] = rotated;
  return [
    { x: pinch(tl, 0.978).x + 12, y: tl.y - 8 },
    { x: pinch(tr, 0.978).x - 6, y: tr.y + 5 },
    { x: pinch(br, 1.018).x + 4, y: br.y + 10 },
    { x: pinch(bl, 1.018).x - 11, y: bl.y - 4 },
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

function warpImageToQuad(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  quad: Quad,
): void {
  const project = squareToQuad(quad);
  const gridSize = 24;
  const sourcePoint = (i: number, j: number): Pt => ({
    x: (i / gridSize) * sourceWidth,
    y: (j / gridSize) * sourceHeight,
  });
  const destinationPoint = (i: number, j: number): Pt => project(i / gridSize, j / gridSize);
  for (let j = 0; j < gridSize; j++) {
    for (let i = 0; i < gridSize; i++) {
      const dTl = destinationPoint(i, j);
      const dTr = destinationPoint(i + 1, j);
      const dBr = destinationPoint(i + 1, j + 1);
      const dBl = destinationPoint(i, j + 1);
      drawTriangle(ctx, image, [sourcePoint(i, j), sourcePoint(i + 1, j), sourcePoint(i, j + 1)], [dTl, dTr, dBl]);
      drawTriangle(
        ctx,
        image,
        [sourcePoint(i + 1, j), sourcePoint(i + 1, j + 1), sourcePoint(i, j + 1)],
        [dTr, dBr, dBl],
      );
    }
  }
}

function paperPath(ctx: CanvasRenderingContext2D, quad: Quad): void {
  const [tl, tr, br, bl] = quad;
  const sides: Array<[Pt, Pt, number]> = [
    [tl, tr, 1.7],
    [tr, br, 1.9],
    [br, bl, 4.8],
    [bl, tl, 2.2],
  ];
  const pointOnSide = (a: Pt, b: Pt, t: number, side: number, amount: number): Pt => {
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / length;
    const ny = (b.x - a.x) / length;
    const phase = side * 11.7 + t * 27.3;
    const jitter = Math.sin(phase) * amount + Math.sin(phase * 2.41) * amount * 0.34;
    return { x: x + nx * jitter, y: y + ny * jitter };
  };

  ctx.beginPath();
  ctx.moveTo(tl.x, tl.y);
  for (let side = 0; side < sides.length; side++) {
    const sideEntry = sides[side];
    if (sideEntry === undefined) continue;
    const [a, b, amount] = sideEntry;
    for (let i = 1; i <= 8; i++) {
      const p = pointOnSide(a, b, i / 8, side, amount);
      ctx.lineTo(p.x, p.y);
    }
  }
  ctx.closePath();
}

function paintPaperGrain(ctx: CanvasRenderingContext2D, quad: Quad, width: number, height: number): void {
  ctx.save();
  paperPath(ctx, quad);
  ctx.clip();
  ctx.globalCompositeOperation = "soft-light";
  const rng = mulberry32(0xface);
  for (let i = 0; i < 13000; i++) {
    const x = rng() * width;
    const y = rng() * height;
    const light = rng() > 0.48;
    ctx.fillStyle = `rgba(${light ? "255,250,240" : "30,22,16"},${(
      0.006 + rng() * 0.018
    ).toFixed(3)})`;
    const size = 0.35 + rng() * 1.35;
    ctx.fillRect(x, y, size, size);
  }
  ctx.restore();
}

function paintShadow(
  ctx: CanvasRenderingContext2D,
  quad: Quad,
): void {
  const paintShadowStamp = (blur: number, alpha: number, dx: number, dy: number): void => {
    ctx.save();
    ctx.filter = `blur(${blur}px)`;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "#000";
    paperPath(
      ctx,
      quad.map((p) => ({ x: p.x + dx, y: p.y + dy })) as Quad,
    );
    ctx.fill();
    ctx.restore();
  };

  // 接触阴影：只保留靠近纸边的短阴影，避免生成规则的“矩形光晕”。
  paintShadowStamp(5, 0.12, 4, 7);
}

function createSurfaceTexture(surface: HTMLImageElement): HTMLCanvasElement | null {
  const source = document.createElement("canvas");
  source.width = surface.naturalWidth;
  source.height = surface.naturalHeight;
  const sourceCtx = source.getContext("2d");
  if (sourceCtx === null) return null;
  sourceCtx.fillStyle = "#d8d2c9";
  sourceCtx.fillRect(0, 0, source.width, source.height);
  sourceCtx.drawImage(surface, 0, 0);
  return source;
}

export async function compositePaperPhoto(bill: HTMLImageElement | ImageBitmap): Promise<Blob> {
  const width = PHOTO_WIDTH;
  const height = PHOTO_HEIGHT;
  const sw = bill instanceof HTMLImageElement ? bill.naturalWidth : bill.width;
  const sh = bill instanceof HTMLImageElement ? bill.naturalHeight : bill.height;
  if (sw === 0 || sh === 0) throw new Error("实拍合成失败：账单图像为空");

  const paperSurface = await loadPaperSurface();

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("实拍合成失败：无法创建 2D 上下文");

  paintDesk(ctx, width, height);

  const quad = billQuad(width, height, sw, sh);
  const surfaceTexture = paperSurface === null ? null : createSurfaceTexture(paperSurface);

  // 1) 贴边的接触阴影，避免规则的矩形光晕。
  paintShadow(ctx, quad);

  // 2) 账单 warp 到独立图层（24×24 网格细分，每格两个三角形仿射近似）。
  const layer = document.createElement("canvas");
  layer.width = width;
  layer.height = height;
  const lctx = layer.getContext("2d");
  if (lctx === null) throw new Error("实拍合成失败：无法创建图层上下文");
  warpImageToQuad(lctx, bill, sw, sh, quad);

  // 3) 账单图层上叠轻微纸张颗粒和环境光；强度保持低，避免盖住票据文字。
  lctx.save();
  quadPath(lctx, quad);
  lctx.clip();
  const noiseRng = mulberry32(0xbeef);
  for (let i = 0; i < 5200; i++) {
    const nx = noiseRng() * width;
    const ny = noiseRng() * height;
    lctx.fillStyle = `rgba(${noiseRng() > 0.5 ? "255,255,255" : "0,0,0"},${(
      0.008 + noiseRng() * 0.022
    ).toFixed(3)})`;
    lctx.fillRect(nx, ny, 0.6 + noiseRng() * 1.7, 0.6 + noiseRng() * 1.7);
  }
  const glare = lctx.createRadialGradient(width * 0.27, height * 0.18, 20, width * 0.45, height * 0.42, width * 0.84);
  glare.addColorStop(0, "rgba(255,246,230,0.13)");
  glare.addColorStop(0.5, "rgba(255,246,230,0.025)");
  glare.addColorStop(1, "rgba(20,10,0,0.08)");
  lctx.fillStyle = glare;
  lctx.fillRect(0, 0, width, height);
  lctx.restore();

  if (surfaceTexture !== null) {
    // 只在纸面路径内叠低强度的实拍纸面光照，避免把素材中的文字带入结果。
    lctx.save();
    paperPath(lctx, quad);
    lctx.clip();
    lctx.globalCompositeOperation = "soft-light";
    lctx.globalAlpha = 0.22;
    const left = Math.min(...quad.map((p) => p.x)) - 10;
    const top = Math.min(...quad.map((p) => p.y)) - 10;
    const right = Math.max(...quad.map((p) => p.x)) + 10;
    const bottom = Math.max(...quad.map((p) => p.y)) + 10;
    const cropX = surfaceTexture.width * 0.12;
    const cropY = surfaceTexture.height * 0.1;
    const cropWidth = surfaceTexture.width * 0.76;
    const cropHeight = surfaceTexture.height * 0.8;
    lctx.drawImage(surfaceTexture, cropX, cropY, cropWidth, cropHeight, left, top, right - left, bottom - top);
    lctx.restore();
  }

  // 用独立的轻微不规则路径收纸边，避免纹理图的 alpha 参与主画布合成。
  lctx.save();
  lctx.globalCompositeOperation = "destination-in";
  paperPath(lctx, quad);
  lctx.fillStyle = "#fff";
  lctx.fill();
  lctx.restore();

  // 先贴账单，再覆盖低强度纸面光照和颗粒，顺序能保留实际拍摄中的纸纤维质感。
  ctx.save();
  ctx.filter = "blur(0.42px)";
  ctx.drawImage(layer, 0, 0);
  ctx.restore();

  paintPaperGrain(ctx, quad, width, height);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob === null ? reject(new Error("实拍合成失败：canvas.toBlob 返回 null")) : resolve(blob),
      "image/jpeg",
      0.92,
    );
  });
}
