/**
 * DOM 栅格化：把自包含 HTML 片段渲染成 PNG Blob。
 * 走 SVG <foreignObject> + data URL → <img> → <canvas> 路线，
 * 全程端侧、无网络、无外部资源（模板只用系统字体栈）。
 */

export interface RasterizeOptions {
  readonly width: number;
  readonly height: number;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("栅格化失败：SVG 图像加载出错"));
    img.src = src;
  });
}

export async function rasterizeHtml(html: string, opts: RasterizeOptions): Promise<Blob> {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${opts.width}" height="${opts.height}">` +
    `<foreignObject width="100%" height="100%">` +
    `<div xmlns="http://www.w3.org/1999/xhtml">${html}</div>` +
    `</foreignObject></svg>`;
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

  // 等字体就绪后再栅格化，避免首帧 fallback 字体
  await document.fonts.ready;
  const img = await loadImage(url);
  await img.decode();

  const canvas = document.createElement("canvas");
  canvas.width = opts.width;
  canvas.height = opts.height;
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("栅格化失败：无法创建 2D 上下文");
  ctx.drawImage(img, 0, 0, opts.width, opts.height);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob === null ? reject(new Error("栅格化失败：canvas.toBlob 返回 null")) : resolve(blob),
      "image/png",
    );
  });
}
