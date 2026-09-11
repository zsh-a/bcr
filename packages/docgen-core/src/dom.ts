/**
 * @bcr/docgen-core/dom — DOM 依赖入口（浏览器专用，node 测试请勿导入）。
 * 提供 HTML → PNG 栅格化、「实拍」合成与一键生成 pipeline。
 */

import { getTemplate, rngForInput } from "./registry";
import { rasterizeHtml } from "./rasterize";
import { compositePaperPhoto, PHOTO_HEIGHT, PHOTO_WIDTH } from "./composite";
import { CANVAS_HEIGHT, CANVAS_WIDTH } from "./templates/common";
import type { BillInput, BillViewModel, RenderOptions } from "./model";

export { rasterizeHtml, type RasterizeOptions } from "./rasterize";
export { compositePaperPhoto, PHOTO_HEIGHT, PHOTO_WIDTH } from "./composite";

export interface RenderedBill {
  readonly vm: BillViewModel;
  readonly html: string;
}

/** 纯逻辑 + 字符串渲染：同 input 必得同 vm/html（billDate 为 null 时取当天） */
export function renderBillHtml(input: BillInput, opts: RenderOptions): RenderedBill {
  const template = getTemplate(input.docType);
  if (template === undefined) throw new Error(`未知的账单类型：${input.docType}`);
  const vm = template.compute(input, rngForInput(input));
  return { vm, html: template.renderHtml(vm, opts) };
}

export interface GeneratedBill {
  readonly vm: BillViewModel;
  /** 账单本体 PNG（由模板画布决定，默认 2481×3509） */
  readonly documentPng: Blob;
  /** 「实拍」合成 JPEG（1620×2160） */
  readonly paperJpeg: Blob;
}

/** 一键 pipeline：render → 栅格化 PNG → 透视合成 JPEG */
export async function generateBill(input: BillInput, opts: RenderOptions): Promise<GeneratedBill> {
  const template = getTemplate(input.docType);
  if (template === undefined) throw new Error(`未知的账单类型：${input.docType}`);
  const { vm, html } = renderBillHtml(input, opts);
  const canvas = template.canvasSize ?? { width: CANVAS_WIDTH, height: CANVAS_HEIGHT };
  const documentPng = await rasterizeHtml(html, canvas);
  const bitmap = await createImageBitmap(documentPng);
  try {
    const paperJpeg = await compositePaperPhoto(bitmap);
    return { vm, documentPng, paperJpeg };
  } finally {
    bitmap.close();
  }
}
