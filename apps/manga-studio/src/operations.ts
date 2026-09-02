import type { ConfigField, Graph, OperationDef } from "@bcr/graph";
import { addEdge, addNode, emptyGraph, updateNodeConfig } from "@bcr/graph";
import type { MangaSettings } from "./model";

const skipCache: ConfigField = {
  key: "skipCache",
  label: "跳过缓存",
  kind: "boolean",
  default: false,
};

const withSkipCache = (fields: ReadonlyArray<ConfigField>): ReadonlyArray<ConfigField> => [
  ...fields,
  skipCache,
];

export const OPERATIONS: ReadonlyArray<OperationDef> = [
  {
    operation: "archive.import",
    label: "Import",
    detail: "图片 / CBZ / ZIP / PDF → 页面清单",
    runtime: "js",
    inputs: [{ name: "source", type: "file/*", label: "源文件" }],
    outputs: [{ name: "manifest", type: "manga/page-manifest", label: "pages" }],
    resources: { memoryMB: 256, threads: 1 },
    config: withSkipCache([]),
  },
  {
    operation: "image.decode-normalize",
    label: "Normalize",
    detail: "解码、方向校正、分块与尺寸标准化",
    runtime: "wasm",
    inputs: [{ name: "manifest", type: "manga/page-manifest", label: "manifest" }],
    outputs: [{ name: "page", type: "image/normalized", label: "page" }],
    resources: { memoryMB: 512, threads: 1 },
    config: withSkipCache([
      { key: "maxDimension", label: "最长边（px）", kind: "number", default: 2400 },
    ]),
  },
  {
    operation: "manga.detect-text",
    label: "Detect",
    detail: "文字区域、气泡与多边形 mask",
    runtime: "webgpu",
    inputs: [{ name: "page", type: "image/normalized", label: "page" }],
    outputs: [{ name: "regions", type: "manga/text-regions", label: "regions" }],
    resources: { memoryMB: 1024, threads: 1, gpu: true },
    config: withSkipCache([
      {
        key: "detector",
        label: "检测器",
        kind: "select",
        options: [
          { value: "fixture", label: "Fixture（离线演示）" },
          { value: "local", label: "Local ONNX（待接入）" },
        ],
        default: "fixture",
      },
    ]),
  },
  {
    operation: "manga.ocr",
    label: "OCR",
    detail: "识别文字、方向、旋转和置信度",
    runtime: "webgpu",
    inputs: [
      { name: "page", type: "image/normalized", label: "page" },
      { name: "regions", type: "manga/text-regions", label: "regions" },
    ],
    outputs: [{ name: "lines", type: "manga/ocr-lines", label: "lines" }],
    resources: { memoryMB: 1536, threads: 1, gpu: true },
    config: withSkipCache([
      {
        key: "language",
        label: "源语言",
        kind: "select",
        options: [
          { value: "ja", label: "日本語" },
          { value: "en", label: "English" },
          { value: "ko", label: "한국어" },
        ],
        default: "ja",
      },
    ]),
  },
  {
    operation: "manga.reading-order",
    label: "Order",
    detail: "按 panel 和阅读方向重排文本块",
    runtime: "wasm",
    inputs: [{ name: "lines", type: "manga/ocr-lines", label: "lines" }],
    outputs: [{ name: "blocks", type: "manga/text-blocks", label: "blocks" }],
    resources: { memoryMB: 256, threads: 1 },
    config: withSkipCache([]),
  },
  {
    operation: "manga.translate",
    label: "Translate",
    detail: "保留区域 ID、换行与术语表上下文翻译",
    runtime: "wasm",
    inputs: [{ name: "blocks", type: "manga/text-blocks", label: "blocks" }],
    outputs: [{ name: "segments", type: "manga/translation-segments", label: "segments" }],
    resources: { memoryMB: 1024, threads: 1 },
    config: withSkipCache([
      {
        key: "engine",
        label: "翻译引擎",
        kind: "select",
        options: [
          { value: "fixture", label: "Fixture（离线演示）" },
          { value: "local", label: "Local model（待接入）" },
        ],
        default: "fixture",
      },
      { key: "targetLanguage", label: "目标语言", kind: "string", default: "zh" },
    ]),
  },
  {
    operation: "manga.remove-text",
    label: "Clean",
    detail: "保留原图，生成可追溯的清理页",
    runtime: "webgpu",
    inputs: [
      { name: "page", type: "image/normalized", label: "page" },
      { name: "regions", type: "manga/text-regions", label: "regions" },
    ],
    outputs: [{ name: "cleanPage", type: "manga/clean-page", label: "clean" }],
    resources: { memoryMB: 1536, threads: 1, gpu: true },
    config: withSkipCache([
      {
        key: "mode",
        label: "清理方式",
        kind: "select",
        options: [
          { value: "fill", label: "填充（MVP）" },
          { value: "inpaint", label: "Inpainting（待接入）" },
        ],
        default: "fill",
      },
    ]),
  },
  {
    operation: "manga.typeset",
    label: "Typeset",
    detail: "CJK 字体回退、换行、竖排与溢出检查",
    runtime: "js",
    inputs: [
      { name: "cleanPage", type: "manga/clean-page", label: "clean" },
      { name: "segments", type: "manga/translation-segments", label: "segments" },
    ],
    outputs: [{ name: "page", type: "manga/typeset-page", label: "translated" }],
    resources: { memoryMB: 512, threads: 1 },
    config: withSkipCache([
      { key: "fontSize", label: "字号缩放", kind: "number", default: 1 },
      { key: "writingMode", label: "默认排版", kind: "string", default: "horizontal-tb" },
    ]),
  },
  {
    operation: "archive.export",
    label: "Export",
    detail: "PNG / WebP / PDF / CBZ / ZIP",
    runtime: "js",
    inputs: [{ name: "page", type: "manga/typeset-page", label: "page" }],
    outputs: [{ name: "export", type: "manga/export", label: "output" }],
    resources: { memoryMB: 256, threads: 1 },
    config: withSkipCache([
      {
        key: "format",
        label: "导出格式",
        kind: "select",
        options: [
          { value: "png", label: "PNG" },
          { value: "webp", label: "WebP" },
          { value: "cbz", label: "CBZ" },
        ],
        default: "png",
      },
    ]),
  },
];

/**
 * A safe first OCR adapter: it turns manually detected regions into the same
 * versioned lines artifact that a future ONNX/WebGPU detector will emit.  It
 * deliberately lives outside the default graph so the graph still advertises
 * the real visual `manga.ocr` capability and does not hide model readiness.
 */
export const REVIEW_OCR_OPERATION: OperationDef = {
  operation: "manga.ocr.review",
  label: "OCR Review",
  detail: "将人工区域固化为可审校 OCR lines Artifact",
  runtime: "wasm",
  inputs: [{ name: "page", type: "file/image", label: "源页面" }],
  outputs: [{ name: "lines", type: "manga/ocr-lines", label: "lines" }],
  resources: { memoryMB: 256, threads: 1 },
  config: withSkipCache([
    {
      key: "adapter",
      label: "OCR 适配器",
      kind: "select",
      options: [{ value: "review.manual", label: "Review / 手工区域" }],
      default: "review.manual",
    },
  ]),
};

/** Opt-in ONNX OCR operation. The model is loaded lazily inside the Worker. */
export const LOCAL_OCR_OPERATION: OperationDef = {
  operation: "manga.ocr.onnx",
  label: "OCR / Local",
  detail: "按区域运行本地 ONNX 识别并保留置信度审校",
  runtime: "wasm",
  inputs: [{ name: "page", type: "file/image", label: "源页面" }],
  outputs: [{ name: "lines", type: "manga/ocr-lines", label: "lines" }],
  resources: { memoryMB: 1536, threads: 1 },
  config: withSkipCache([
    {
      key: "model",
      label: "模型",
      kind: "string",
      default: "Xenova/trocr-small-printed",
    },
    {
      key: "device",
      label: "设备",
      kind: "select",
      options: [
        { value: "auto", label: "Auto" },
        { value: "webgpu", label: "WebGPU" },
        { value: "wasm", label: "WASM" },
      ],
      default: "auto",
    },
  ]),
};

/** Opt-in text translation operation. The Worker resolves the multilingual NLLB model. */
export const LOCAL_TRANSLATION_OPERATION: OperationDef = {
  operation: "manga.translate.onnx",
  label: "Translate / Local",
  detail: "懒加载多语 NLLB，并保留术语表与人工审校边界",
  runtime: "wasm",
  inputs: [{ name: "lines", type: "manga/ocr-lines", label: "lines" }],
  outputs: [{ name: "segments", type: "manga/translation-lines", label: "segments" }],
  resources: { memoryMB: 2048, threads: 1 },
  config: withSkipCache([
    {
      key: "model",
      label: "模型",
      kind: "string",
      default: "Xenova/nllb-200-distilled-600M",
    },
    {
      key: "sourceLanguage",
      label: "源语言",
      kind: "select",
      options: [
        { value: "ja", label: "日本語" },
        { value: "en", label: "English" },
        { value: "ko", label: "한국어" },
      ],
      default: "ja",
    },
    { key: "targetLanguage", label: "目标语言", kind: "string", default: "zh" },
    {
      key: "device",
      label: "设备",
      kind: "select",
      options: [
        { value: "auto", label: "Auto" },
        { value: "webgpu", label: "WebGPU" },
        { value: "wasm", label: "WASM" },
      ],
      default: "auto",
    },
  ]),
};

/** Safe cleaning boundary. Inpaint remains an explicit request until a model is verified. */
export const CLEAN_PREVIEW_OPERATION: OperationDef = {
  operation: "manga.clean.preview",
  label: "Clean / Safe Preview",
  detail: "生成区域掩码 Artifact；Inpaint 未就绪时记录并回退 Fill",
  runtime: "wasm",
  inputs: [{ name: "source", type: "file/image", label: "源页面" }],
  outputs: [{ name: "cleanPage", type: "manga/clean-page", label: "clean" }],
  resources: { memoryMB: 512, threads: 1 },
  config: withSkipCache([
    {
      key: "mode",
      label: "清理方式",
      kind: "select",
      options: [
        { value: "fill", label: "Fill / 稳定" },
        { value: "inpaint", label: "Inpaint / 实验（回退 Fill）" },
      ],
      default: "fill",
    },
  ]),
};

function operation(operation: string): OperationDef {
  const found = OPERATIONS.find((item) => item.operation === operation);
  if (found === undefined) throw new Error(`unknown operation ${operation}`);
  return found;
}

/** Default graph is intentionally explicit: reviewers can later open it in GraphCanvas. */
export function defaultGraph(settings: MangaSettings): Graph {
  let graph = addNode(emptyGraph, operation("archive.import"), "import", 24, 160);
  graph = addNode(graph, operation("image.decode-normalize"), "normalize", 244, 160);
  graph = addNode(graph, operation("manga.detect-text"), "detect", 468, 72);
  graph = addNode(graph, operation("manga.ocr"), "ocr", 692, 160);
  graph = addNode(graph, operation("manga.reading-order"), "order", 916, 160);
  graph = addNode(graph, operation("manga.translate"), "translate", 1140, 160);
  graph = addNode(graph, operation("manga.remove-text"), "clean", 916, 360);
  graph = addNode(graph, operation("manga.typeset"), "typeset", 1364, 260);
  graph = addNode(graph, operation("archive.export"), "export", 1588, 260);

  for (const [from, to] of [
    ["import", "normalize"],
    ["normalize", "detect"],
    ["normalize", "ocr"],
    ["detect", "ocr"],
    ["ocr", "order"],
    ["order", "translate"],
    ["normalize", "clean"],
    ["detect", "clean"],
    ["clean", "typeset"],
    ["translate", "typeset"],
    ["typeset", "export"],
  ] as const) {
    graph = addEdge(graph, OPERATIONS, from, to) ?? graph;
  }

  graph = updateNodeConfig(graph, "ocr", { language: settings.sourceLanguage });
  graph = updateNodeConfig(graph, "translate", {
    engine: settings.engine,
    targetLanguage: settings.targetLanguage,
  });
  graph = updateNodeConfig(graph, "clean", { mode: settings.cleanMode });
  return updateNodeConfig(graph, "typeset", { fontSize: settings.fontSize });
}
